import { ChevronDown } from 'lucide-react';
import { MARKETS, type Market } from '../markets';

type Props = {
  market: Market;
  onChange: (market: Market) => void;
};

export default function MarketSelector({ market, onChange }: Props) {
  return (
    <label className="market-selector">
      <img
        className="market-logo"
        src={`${import.meta.env.BASE_URL}${market.logoPath}`}
        alt=""
        width={28}
        height={28}
      />
      <span className="market-selector-control">
        <span className="market-selector-label">Market</span>
        <select
          aria-label="Select market"
          value={market.id}
          onChange={(event) => {
            const selected = MARKETS.find(
              (item) => item.id === event.target.value,
            );
            if (selected) onChange(selected);
          }}
        >
          {MARKETS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </span>
      <ChevronDown className="market-selector-chevron" aria-hidden="true" />
    </label>
  );
}
