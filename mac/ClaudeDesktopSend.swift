import AppKit
import ApplicationServices
import Foundation

let bundleID = "com.anthropic.claudefordesktop"

func stop(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func attribute<T>(_ element: AXUIElement, _ name: String) -> T? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value as? T
}

func descendants(_ root: AXUIElement) -> [AXUIElement] {
    var queue = [root]
    var result: [AXUIElement] = []
    while !queue.isEmpty && result.count < 20_000 {
        let element = queue.removeFirst()
        result.append(element)
        let children: [AXUIElement] = attribute(element, kAXChildrenAttribute) ?? []
        queue.append(contentsOf: children)
    }
    return result
}

let data = FileHandle.standardInput.readDataToEndOfFile()
guard let message = String(data: data, encoding: .utf8), !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
    stop("message is empty")
}
guard AXIsProcessTrusted() else {
    stop("Accessibility permission required for Fleetdeck's Claude bridge")
}
guard let claude = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first else {
    stop("Claude Desktop is not running")
}

let previous = NSWorkspace.shared.frontmostApplication
if previous?.processIdentifier != claude.processIdentifier {
    claude.activate(options: [])
}
defer {
    if let previous, previous.processIdentifier != claude.processIdentifier {
        previous.activate(options: [])
    }
}

let app = AXUIElementCreateApplication(claude.processIdentifier)
// Electron only exposes the renderer's accessibility tree after a client opts in.
AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)

func currentWindow() -> AXUIElement? {
    if let focused: AXUIElement = attribute(app, kAXFocusedWindowAttribute) { return focused }
    return (attribute(app, kAXWindowsAttribute) as [AXUIElement]?)?.first
}

func findPrompt() -> AXUIElement? {
    guard let window = currentWindow() else { return nil }
    return descendants(window).first { element in
        let role: String = attribute(element, kAXRoleAttribute) ?? ""
        let description: String = attribute(element, kAXDescriptionAttribute) ?? ""
        let placeholder: String = attribute(element, kAXPlaceholderValueAttribute) ?? ""
        return role == kAXTextAreaRole && (description == "Prompt" || placeholder.contains("Type / for commands"))
    }
}

let promptDeadline = Date().addingTimeInterval(5)
var foundPrompt: AXUIElement?
repeat {
    foundPrompt = findPrompt()
    if foundPrompt == nil { Thread.sleep(forTimeInterval: 0.2) }
} while foundPrompt == nil && Date() < promptDeadline
guard let prompt = foundPrompt else { stop("Claude prompt field not found") }

let existing: String = attribute(prompt, kAXValueAttribute) ?? ""
// An "empty" composer reports a lone newline, or leaks its placeholder text into AXValue.
let normalizedExisting = existing.trimmingCharacters(in: .whitespacesAndNewlines)
guard normalizedExisting.isEmpty || normalizedExisting.hasPrefix("Type / for commands") || existing == message else {
    stop("Claude prompt is not empty; refusing to overwrite its draft")
}

AXUIElementSetAttributeValue(prompt, kAXFocusedAttribute as CFString, kCFBooleanTrue)
guard existing == message || AXUIElementSetAttributeValue(prompt, kAXValueAttribute as CFString, message as CFString) == .success else {
    stop("Claude prompt field rejected the message")
}

let deadline = Date().addingTimeInterval(3)
var sendButton: AXUIElement?
repeat {
    sendButton = currentWindow().flatMap { window in descendants(window).first { element in
        let role: String = attribute(element, kAXRoleAttribute) ?? ""
        let title: String = attribute(element, kAXTitleAttribute) ?? ""
        let description: String = attribute(element, kAXDescriptionAttribute) ?? ""
        return role == kAXButtonRole && (title == "Send" || description == "Send")
    } }
    if sendButton == nil { Thread.sleep(forTimeInterval: 0.05) }
} while sendButton == nil && Date() < deadline

guard let sendButton else { stop("Claude Send button did not appear") }
guard AXUIElementPerformAction(sendButton, kAXPressAction as CFString) == .success else {
    stop("Claude Send button rejected the press")
}
print("sent")
