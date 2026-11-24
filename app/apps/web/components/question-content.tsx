'use client';

import { Fragment, memo, useEffect, useRef, useState, type ReactNode } from 'react';
import katex from 'katex';
import { apiBlob } from '../lib/api';

const tokens =
  /(?<fence>^```[^\n]*\n[\s\S]*?\n```(?=\r?$))|(?<code>`[^`\n]+`)|(?<display>\\\[[\s\S]+?\\\])|(?<inline>\\\([^\n]+?\\\))|(?<bold>\*\*[^\n]+?\*\*)/gm;

function renderText(text: string, bold = true): ReactNode[] {
  const nodes: ReactNode[] = [];
  let end = 0;
  for (const match of text.matchAll(tokens)) {
    const { fence, code, display, inline, bold: strong } = match.groups!;
    nodes.push(text.slice(end, match.index));
    let node: ReactNode = match[0];
    if (fence) {
      node = (
        <code className="question-code-block">
          {fence.slice(fence.indexOf('\n') + 1, -4).replace(/\r$/, '')}
        </code>
      );
    } else if (code) {
      node = <code>{code.slice(1, -1)}</code>;
    } else if (display || inline) {
      const html = katex.renderToString(match[0].slice(2, -2), {
        displayMode: Boolean(display),
        trust: false,
        throwOnError: false,
        strict: 'ignore',
        maxExpand: 100,
        maxSize: 20,
      });
      node = (
        <span
          className={display ? 'question-math-block' : undefined}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    } else if (strong && bold) {
      node = <strong>{renderText(strong.slice(2, -2), false)}</strong>;
    }
    nodes.push(<Fragment key={match.index}>{node}</Fragment>);
    end = match.index + match[0].length;
  }
  nodes.push(text.slice(end));
  return nodes;
}

export const QuestionText = memo(function QuestionText({
  text,
  markdown,
}: {
  text: string;
  markdown: boolean;
}) {
  return markdown ? <span className="question-markdown">{renderText(text)}</span> : <>{text}</>;
});

export function QuestionImage({
  path,
  alt,
  preview,
}: {
  path: string;
  alt: string;
  preview?: File;
}) {
  return <PrivateImage key={path} path={path} alt={alt} preview={preview} />;
}

function PrivateImage({ path, alt, preview }: { path: string; alt: string; preview?: File }) {
  const holder = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!holder.current || visible) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true);
      },
      { rootMargin: '120px' },
    );
    observer.observe(holder.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let objectUrl = '';
    setFailed(false);
    setUrl('');
    (preview ? Promise.resolve(preview) : apiBlob(path))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, preview, retry, visible]);

  return (
    <span className="question-image" ref={holder}>
      {failed ? (
        <span>
          {alt}{' '}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setRetry((n) => n + 1)}
          >
            Retry image
          </button>
        </span>
      ) : url ? (
        <img src={url} alt={alt} onError={() => setFailed(true)} />
      ) : (
        <span className="muted">Loading image…</span>
      )}
    </span>
  );
}
