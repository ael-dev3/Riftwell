import { ChevronDown } from 'lucide-react';
import { MARKETS, type Market } from '../markets';

type Props = {
  market: Market;
  onChange: (market: Market) => void;
};

/** Native select for robust keyboard and screen-reader support. */
export default function MarketSelector({ market, onChange }: Props) {
  return (
    <label className="market-selector">
      <img
        className="market-logo"
        src={`${import.meta.env.BASE_URL}${market.logoPath}`}
        alt=""
        width={20}
        height={20}
      />
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
      <ChevronDown
        className="market-selector-chevron"
        size={14}
        aria-hidden="true"
      />
    </label>
  );
}
