import React from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import type { SeriesSuggestion } from '../lib/collections';

interface SuggestedSeriesBannerProps {
  suggestions: SeriesSuggestion[];
  onAccept: (suggestion: SeriesSuggestion) => void;
  onDismiss: (suggestionName: string) => void;
}

export const SuggestedSeriesBanner: React.FC<SuggestedSeriesBannerProps> = ({
  suggestions,
  onAccept,
  onDismiss,
}) => {
  if (suggestions.length === 0) return null;

  return (
    <div className="mb-4 space-y-2 rounded-[var(--radius-lg)] border border-[var(--stroke-subtle)] bg-[var(--surface-sunken)]/40 p-3.5">
      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--text-primary)]">
        <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
        <span>Suggested Series from Metadata</span>
        <span className="rounded-full bg-[var(--accent-dim)] px-1.5 py-0.2 text-[10px] font-medium text-[var(--accent)]">
          {suggestions.length}
        </span>
      </div>

      <div className="space-y-2 pt-1">
        {suggestions.slice(0, 3).map((sug) => (
          <div
            key={sug.name}
            className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--stroke-subtle)] bg-[var(--surface-raised)] px-3 py-2 text-left"
          >
            <div className="min-w-0 pr-3">
              <h4 className="truncate text-[12.5px] font-medium text-[var(--text-primary)]">
                {sug.name}
              </h4>
              <p className="text-[11px] text-[var(--text-tertiary)]">
                {sug.reason}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => onAccept(sug)}
                className="flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--accent)] px-2.5 py-1 text-[11.5px] font-medium text-white transition-opacity hover:opacity-90"
              >
                <Check className="h-3 w-3" />
                Add Series
              </button>
              <button
                type="button"
                onClick={() => onDismiss(sug.name)}
                className="icon-button h-6 w-6"
                aria-label={`Dismiss ${sug.name} suggestion`}
                title="Dismiss suggestion"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
