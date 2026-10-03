import { ArrowUpRight, Megaphone } from 'lucide-react';
import { useState } from 'react';
import { RELEASE_NOTES, type ReleaseNote } from '../../changelog';
import { formatDate } from '../../domain';
import Popover from '../ui/Popover';

function NoteLink({ note }: { note: ReleaseNote }) {
  if (!note.href) return <span className="ticker-title">{note.title}</span>;
  return (
    <a
      className="ticker-title"
      href={note.href}
      target="_blank"
      rel="noreferrer"
    >
      {note.title}
      <ArrowUpRight size={12} aria-hidden="true" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** Recent releases, newest first. */
export function ReleaseList() {
  return (
    <ul className="release-list">
      {RELEASE_NOTES.map((note) => (
        <li key={note.id}>
          <span
            className={`pill ${note.kind === 'Docs' ? 'violet' : 'accent'}`}
          >
            {note.kind}
          </span>
          <span className="release-body">
            <strong>{note.title}</strong>
            <small>{note.summary}</small>
            <span className="release-meta">
              <time dateTime={note.date}>{formatDate(note.date)}</time>
              {note.href && (
                <a href={note.href} target="_blank" rel="noreferrer">
                  Read more
                  <span className="sr-only">
                    {' '}
                    about {note.title} (opens in a new tab)
                  </span>
                </a>
              )}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Header button listing recent releases. */
export function WhatsNew() {
  return (
    <Popover
      trigger={<Megaphone size={18} aria-hidden="true" />}
      triggerLabel="What’s new"
      title="What’s new"
      className="whats-new"
      triggerClassName="icon-button ghost"
    >
      <ReleaseList />
    </Popover>
  );
}

/** One release at a time in the context bar; the dots switch it. */
export function UpdatesTicker() {
  const [index, setIndex] = useState(0);
  const note = RELEASE_NOTES[index];
  if (!note) return null;
  return (
    <div className="ticker" role="group" aria-label="Latest updates">
      <span className={`pill ${note.kind === 'Docs' ? 'violet' : 'accent'}`}>
        {note.kind}
      </span>
      <NoteLink note={note} />
      <span className="ticker-dots">
        {RELEASE_NOTES.map((item, position) => (
          <button
            key={item.id}
            type="button"
            className="ticker-dot"
            aria-label={`Show update ${position + 1} of ${RELEASE_NOTES.length}: ${item.title}`}
            aria-pressed={position === index}
            onClick={() => setIndex(position)}
          />
        ))}
      </span>
    </div>
  );
}
