import { Megaphone } from 'lucide-react';
import { RELEASE_NOTES } from '../../changelog';
import { formatDate } from '../../domain';
import Popover from '../ui/Popover';

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
