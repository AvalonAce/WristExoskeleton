// Modal panel. Escape and the backdrop close it (unless `locked`); focus moves in on open and
// returns to the opener on close; Tab stays inside.
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './Dialog.css';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  locked?: boolean; // ignore Escape/backdrop (e.g. while saving)
  width?: number;
}

export default function Dialog({ title, onClose, children, footer, locked = false, width = 520 }: Props) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = panel.current!;
    (el.querySelector<HTMLElement>('[autofocus], input, select, textarea, button') ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !locked) onClose();
      if (e.key !== 'Tab') return;
      const f = [...el.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]')]
        .filter((x) => !x.hasAttribute('disabled'));
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); opener?.focus(); };
  }, [onClose, locked]);

  return createPortal(
    <div className="dlg-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !locked) onClose(); }}>
      <div ref={panel} className="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-title"
        tabIndex={-1} style={{ maxWidth: width }}>
        <header className="dlg-head">
          <h2 id="dlg-title">{title}</h2>
          {!locked && <button className="dlg-x" onClick={onClose} aria-label="Close">×</button>}
        </header>
        <div className="dlg-body">{children}</div>
        {footer && <footer className="dlg-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
