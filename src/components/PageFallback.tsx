/** Placeholder shown while a code-split page loads. */
export default function PageFallback() {
  return (
    <div className="page-skeleton" aria-busy="true" aria-label="Loading page">
      <span className="skeleton heading" />
      <span className="skeleton line" />
      <div className="skeleton-grid">
        <span className="skeleton card" />
        <span className="skeleton card" />
        <span className="skeleton card" />
      </div>
      <span className="skeleton block" />
    </div>
  );
}
