import Link from 'next/link';

export function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="topbar">
      <div className="container">
        <Link href="/" className="brand" aria-label="Tepahti, inicio">
          <picture>
            <source srcSet="/brand/mark-white.svg" media="(prefers-color-scheme: dark)" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-mark" src="/brand/mark.svg" alt="" width={30} height={30} />
          </picture>
          tepahti
        </Link>
        <span className="spacer" />
        {children}
      </div>
    </header>
  );
}
