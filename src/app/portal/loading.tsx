/** Shown instantly while a page's data loads, so every click gets immediate feedback. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-pulse">
      <div className="mb-2 h-6 w-48 rounded bg-line" />
      <div className="mb-6 h-4 w-96 max-w-full rounded bg-line/70" />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="panel h-20" />
        ))}
      </div>
      <div className="panel mb-5 h-24" />
      <div className="panel h-72" />
    </div>
  );
}
