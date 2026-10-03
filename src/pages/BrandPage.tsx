import { Check, Copy, Download } from 'lucide-react';
import { useState } from 'react';
import { copyText } from '../app/links';
import { useToast } from '../app/toast';
import { PageHead } from '../components/page';
import type { Market } from '../markets';

const BASE = import.meta.env.BASE_URL;

const MARKS = [
  {
    id: 'dark',
    title: 'Mark on dark',
    text: 'For dark backgrounds and app icons.',
    file: 'brand/riftwell-mark-dark.svg',
  },
  {
    id: 'light',
    title: 'Mark on light',
    text: 'For light backgrounds and print.',
    file: 'brand/riftwell-mark-light.svg',
  },
] as const;

const COLORS = [
  { name: 'Market accent', hex: '#BFF4AA', role: 'KittenSwap market color' },
  { name: 'Ink', hex: '#0B0B12', role: 'Dark background' },
  { name: 'Surface', hex: '#12121C', role: 'Dark workspaces' },
  { name: 'Paper', hex: '#F5F4F8', role: 'Light background' },
  { name: 'Text', hex: '#F0EDF7', role: 'Text on dark' },
  { name: 'Forest', hex: '#1B5221', role: 'Accent text on light' },
  { name: 'Violet', hex: '#B7A6FF', role: 'Riftwell portal and navigation' },
  { name: 'Sky', hex: '#8CC6FF', role: 'Liquidity and rewards' },
] as const;

function Swatch({ name, hex, role }: (typeof COLORS)[number]) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <li className="swatch">
      <span className="swatch-chip" style={{ background: hex }} />
      <span className="swatch-text">
        <strong>{name}</strong>
        <small>{role}</small>
      </span>
      <button
        type="button"
        className="button ghost small mono-button"
        aria-label={`Copy ${name} ${hex}`}
        onClick={() =>
          void copyText(hex).then((ok) => {
            setCopied(ok);
            toast(
              ok ? `${hex} copied.` : 'Copy failed.',
              ok ? 'info' : 'warning',
            );
            if (ok) window.setTimeout(() => setCopied(false), 1600);
          })
        }
      >
        {hex}
        {copied ? (
          <Check size={14} aria-hidden="true" />
        ) : (
          <Copy size={14} aria-hidden="true" />
        )}
      </button>
    </li>
  );
}

export default function BrandPage({ market }: { market: Market }) {
  return (
    <>
      <PageHead
        title="Brand kit"
        lede="The Riftwell mark, colors and type, for articles, integrations and community content."
      />
      <section className="panel" aria-labelledby="marks-title">
        <div className="block-head">
          <h2 id="marks-title">Mark</h2>
          <span className="text-muted">SVG</span>
        </div>
        <ul className="brand-marks">
          {MARKS.map((mark) => (
            <li key={mark.id} className={`brand-mark-card ${mark.id}`}>
              <span className="brand-mark-preview">
                <img
                  src={`${BASE}${mark.file}`}
                  alt={`Riftwell portal mark, ${mark.id} version`}
                  width="96"
                  height="96"
                />
              </span>
              <span className="brand-mark-meta">
                <strong>{mark.title}</strong>
                <small>{mark.text}</small>
              </span>
              <a
                className="button secondary small"
                href={`${BASE}${mark.file}`}
                download={`riftwell-mark-${mark.id}.svg`}
              >
                <Download size={14} aria-hidden="true" /> Download SVG
              </a>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel" aria-labelledby="wordmark-title">
        <div className="block-head">
          <h2 id="wordmark-title">Wordmark</h2>
          <span className="text-muted">Set in type, not an image</span>
        </div>
        <div className="wordmark-specimens">
          <p className="wordmark-specimen dark" aria-hidden="true">
            riftwell<span>.</span>
          </p>
          <p className="wordmark-specimen light" aria-hidden="true">
            riftwell<span>.</span>
          </p>
        </div>
        <p className="panel-text">
          Write the wordmark in lowercase with a violet period. The selected
          market color, {market.accentColor.toUpperCase()} for {market.name},
          belongs to market actions and data. In sentences, write Riftwell.
        </p>
      </section>
      <section className="panel" aria-labelledby="colors-title">
        <div className="block-head">
          <h2 id="colors-title">Colors</h2>
          <span className="text-muted">Select a value to copy it</span>
        </div>
        <ul className="swatches">
          {COLORS.map((color) => (
            <Swatch key={color.hex} {...color} />
          ))}
        </ul>
      </section>
      <section className="panel" aria-labelledby="type-title">
        <div className="block-head">
          <h2 id="type-title">Typography</h2>
          <span className="text-muted">System fonts</span>
        </div>
        <dl className="type-specimens">
          <div>
            <dt>Display and text</dt>
            <dd className="type-sample display">Borrow against veKITTEN</dd>
            <dd className="type-stack">
              Inter where installed, then Segoe UI, SF Pro and system UI ·
              weights 400–700
            </dd>
          </div>
          <div>
            <dt>Figures and labels</dt>
            <dd className="type-sample mono">EPOCH 2961 · 5d 03h 20m</dd>
            <dd className="type-stack">
              System monospace: SF Mono, Cascadia Mono, Menlo, Consolas
            </dd>
          </div>
        </dl>
      </section>
      <section className="panel" aria-labelledby="usage-title">
        <div className="block-head">
          <h2 id="usage-title">Usage</h2>
        </div>
        <ul className="usage-list">
          <li>
            Keep clear space around the mark of at least a quarter of its width.
          </li>
          <li>
            Use the mark on its own rounded tile; do not stretch or rotate it.
          </li>
          <li>
            Keep the portal violet; use the selected market color for market
            controls.
          </li>
          <li>Do not imply that Riftwell endorses a project or product.</li>
        </ul>
      </section>
    </>
  );
}
