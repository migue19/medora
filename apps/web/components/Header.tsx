import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';

export function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="topbar">
      <div className="container">
        <Link href="/" className="brand" aria-label="Tepahti, inicio">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-mark" src="/brand/mark.svg" alt="" width={30} height={30} />
          tepahti
        </Link>
        <span className="spacer" />
        {children}
        <ThemeToggle />
      </div>
    </header>
  );
}
