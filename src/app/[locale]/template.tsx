/** Smooth transition between pages (pure CSS so content is visible before hydration) */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
