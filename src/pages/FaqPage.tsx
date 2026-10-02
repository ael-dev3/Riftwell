import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { PageHead } from '../components/page';
import { SAMPLE_CREDIT_EPOCHS } from '../data';
import type { Market } from '../markets';

type Entry = { question: string; answer: ReactNode };

export default function FaqPage({
  market,
  mode,
}: {
  market: Market;
  mode: 'preview' | 'connected';
}) {
  const entries: Entry[] = [
    {
      question: 'What is Riftwell?',
      answer: (
        <>
          Riftwell is one place to use {market.positionSymbol} positions: borrow
          USDC against them, supply USDC to the pooled vault that funds those
          loans, and buy or sell positions in a marketplace. It starts with{' '}
          {market.name} on {market.chain}.
        </>
      ),
    },
    {
      question: 'How is my credit limit calculated?',
      answer: (
        <>
          Credit follows a position’s reward history, not its market price. The
          preview uses an example policy of net reward per epoch ×{' '}
          {SAMPLE_CREDIT_EPOCHS} epochs. The launched policy, eligibility and
          limits will be published with the contracts. Borrowing is also capped
          by idle USDC in the vault.
        </>
      ),
    },
    {
      question: 'How do loans repay themselves?',
      answer: (
        <>
          Deposited positions keep earning trading fees and incentives each
          weekly epoch. Each epoch those rewards are processed: a portion repays
          your debt, alongside the lender and protocol revenue shares configured
          at launch. In the preview, net rewards repay debt first. Lower rewards
          slow repayment and no rewards means no automatic repayment, so payoff
          time is an estimate, never a schedule. You can repay any amount early.
        </>
      ),
    },
    {
      question: 'Is there interest, a maturity or a liquidation price?',
      answer: (
        <>
          There is no negotiated APR and no fixed maturity. Borrowing carries a
          one-time 0.5% origination fee on the amount drawn; lender and protocol
          revenue shares are set when the vault launches. The preview has no
          price-triggered liquidation, and collateral can only be removed while
          the remaining positions cover your debt. Eligibility, default and
          release rules for the launched vault are published with the contracts.
        </>
      ),
    },
    {
      question: 'When does an epoch flip?',
      answer: (
        <>
          {market.name} reward periods are weekly and start every Thursday at
          00:00 UTC. The countdown at the top of every page tracks the current
          period.
        </>
      ),
    },
    {
      question: 'How do vault withdrawals work?',
      answer: (
        <>
          Your vault shares represent a portion of idle USDC plus outstanding
          loans. You can withdraw up to your share value, but only from idle
          USDC. When the vault is highly utilized, withdrawals wait for
          repayments or new supply. There is no withdrawal queue or secondary
          share market.
        </>
      ),
    },
    {
      question: 'What does the marketplace charge?',
      answer: (
        <>
          Sellers pay 0.5% of the sale price when a sale settles. Buyers pay the
          ask. Saving a listing is free and never transfers, escrows or approves
          your position.
        </>
      ),
    },
    {
      question: 'Can I buy a position with credit?',
      answer: (
        <>
          In the preview, choose <strong>Credit line</strong> when buying: the
          position is deposited as collateral, you can borrow against it, and
          the borrowed USDC helps pay the ask in one step. Its rewards then
          repay that balance.
        </>
      ),
    },
    {
      question:
        mode === 'preview' ? 'Is any of this live?' : 'What works today?',
      answer:
        mode === 'preview' ? (
          <>
            No. This preview runs entirely in your browser with demo positions
            and balances. Nothing connects a wallet, requests a signature or
            moves funds. The source and experimental contracts are public for
            review.
          </>
        ) : (
          <>
            This app supports wallet sign-in, verified {market.positionSymbol}{' '}
            ownership reads and durable off-chain listings. Funded lending,
            vault deposits and purchase settlement launch separately after
            independent review.
          </>
        ),
    },
  ];
  return (
    <>
      <PageHead
        eyebrow="FREQUENTLY ASKED"
        title="Questions, answered"
        lede="How credit, rewards, the vault and the marketplace fit together."
      />
      <div className="faq-list">
        {entries.map((entry, index) => (
          <details className="faq-item" key={entry.question} open={index === 0}>
            <summary>
              <span>{entry.question}</span>
              <ChevronDown size={18} aria-hidden="true" />
            </summary>
            <div className="faq-answer">
              <p>{entry.answer}</p>
            </div>
          </details>
        ))}
      </div>
    </>
  );
}
