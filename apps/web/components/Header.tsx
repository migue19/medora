import Link from 'next/link';

export function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="topbar">
      <div className="container">
        <Link href="/" className="brand"><span className="brand-mark" aria-hidden>+</span>Medora</Link>
        <span className="spacer" />
        {children}
      </div>
    </header>
  );
}
