import { Notice } from '../components/ui/Bits';
import { PageHead } from '../components/page';

const PREVIEW_KEYS = [
  [
    'riftwell.pooled-lending-preview.v1',
    'Demo balances, collateral, relayer positions, vault shares and activity',
  ],
  ['riftwell.marketplace-preview.v3', 'Purchase receipts'],
  ['riftwell.preview-listings.v1', 'Your listings, including private ones'],
  ['riftwell.vote-plan.v1', 'Your saved vote plan'],
  ['riftwell.theme', 'Light or dark theme'],
] as const;

export default function PrivacyPage({
  mode,
}: {
  mode: 'preview' | 'connected';
}) {
  return (
    <>
      <PageHead
        title="What Riftwell stores"
        lede="Where your data lives in each version of the app. This page describes the open-source software; a hosted service may publish its own policies."
      />
      <section className="panel prose" aria-labelledby="privacy-preview">
        <h2 id="privacy-preview">In the preview</h2>
        <p>
          The preview runs entirely in your browser. It saves your demo account
          to this browser’s local storage and sends nothing to a server:
        </p>
        <dl className="facts">
          {PREVIEW_KEYS.map(([key, text]) => (
            <div key={key}>
              <dt>
                <code>{key}</code>
              </dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
        <p>
          Reset preview clears everything except the theme. Clearing this site’s
          data in your browser removes all of it.
        </p>
      </section>
      <section className="panel prose" aria-labelledby="privacy-connected">
        <h2 id="privacy-connected">In the connected app</h2>
        <ul className="usage-list">
          <li>
            Signing in asks your wallet to sign a one-time message. It proves
            you control the address; it never approves tokens or sends a
            transaction.
          </li>
          <li>
            Same-origin hosting uses an HttpOnly session cookie. Separate
            frontend and API hosting keeps the session token only in browser
            memory; reloading signs you out. The service stores only a token
            hash, and sessions expire after eight hours.
          </li>
          <li>
            The service stores your wallet address and the off-chain records you
            create, such as listings, in its database.
          </li>
          <li>
            Ownership is checked through the service’s own chain connection; the
            app does not call a blockchain endpoint from your browser.
          </li>
          <li>
            Service logs redact cookies and authorization headers and leave out
            request bodies and signatures. The operator decides how long logs
            and records are kept.
          </li>
        </ul>
      </section>
      <section className="panel prose" aria-labelledby="privacy-never">
        <h2 id="privacy-never">In every version</h2>
        <ul className="usage-list">
          <li>No analytics, advertising trackers or third-party fonts.</li>
          <li>No private keys or seed phrases are requested or stored.</li>
          <li>
            Links to the source code and documentation open on GitHub, which has
            its own privacy policy.
          </li>
        </ul>
      </section>
      <Notice>
        {mode === 'preview'
          ? 'You are using the preview. Nothing here leaves this browser.'
          : 'You are using the connected app. Your sign-in and records are handled as described above.'}
      </Notice>
    </>
  );
}
