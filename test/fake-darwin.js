// Preloaded with --require so a deck child believes it is running on a Mac. The platform half
// of the route gate (XYZ-1890 M1) is otherwise untestable on Linux CI, and "the operator's Mac
// still serves its cert-mint routes" is the property that must not silently break.
Object.defineProperty(process, 'platform', { value: 'darwin' });
