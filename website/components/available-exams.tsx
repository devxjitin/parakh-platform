"use client";

import { useEffect, useMemo, useState } from "react";
import { API_URL, appUrl, formatInr, type CatalogExamDto } from "../lib/config";
import { Icon } from "./icons";
import { Reveal } from "./reveal";

type State =
  | { kind: "loading" }
  | { kind: "ready"; exams: CatalogExamDto[] }
  | { kind: "error" };

/**
 * The exams students can take any time. Read live from the Parakh API, so an exam an admin
 * publishes shows up here without anyone editing or rebuilding this page.
 */
export function AvailableExams() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`${API_URL}/catalog/exams`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then(
        (d: { exams: CatalogExamDto[] }) =>
          live && setState({ kind: "ready", exams: d.exams }),
      )
      .catch(() => live && setState({ kind: "error" }));
    return () => {
      live = false;
    };
  }, []);

  const all = state.kind === "ready" ? state.exams : [];
  const catOf = (e: CatalogExamDto) => e.category.trim() || "Other";
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of all) counts.set(catOf(e), (counts.get(catOf(e)) ?? 0) + 1);
    const names = [...counts.keys()].sort((a, b) =>
      a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b),
    );
    return names.map((n) => ({ name: n, count: counts.get(n)! }));
  }, [all]);
  // No "All" tab: the first field is shown until another one is picked.
  const active = categories.some((c) => c.name === category)
    ? category
    : (categories[0]?.name ?? "");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((e) => {
      // A search looks across every field; otherwise only the picked field is shown.
      if (!q) return catOf(e) === active;
      return [e.title, e.summary ?? "", catOf(e), ...e.topics].some((t) =>
        t.toLowerCase().includes(q),
      );
    });
  }, [all, query, active]);

  return (
    <section className="lp-section" id="exams" aria-labelledby="exams-title">
      <div className="lp-container">
        <Reveal className="lp-head lp-head-center">
          <span className="lp-eyebrow">Available exams</span>
          <h2 id="exams-title">Test yourself, any time you are ready.</h2>
          <p>
            Pick an exam, pay once and start straight away. Your result and
            certificate come to your email.
          </p>
        </Reveal>

        {state.kind === "loading" && (
          <div className="lp-exams" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="lp-exam lp-exam-skeleton" />
            ))}
          </div>
        )}

        {state.kind === "error" && (
          <p style={{ textAlign: "center" }}>
            We could not load the exams right now. Please{" "}
            <a href={appUrl("/join/")}>open the exam page</a> or try again in a
            moment.
          </p>
        )}

        {state.kind === "ready" && state.exams.length === 0 && (
          <p style={{ textAlign: "center" }}>
            New exams are on their way. Check back soon.
          </p>
        )}

        {state.kind === "ready" && state.exams.length > 0 && (
          <div className="lp-exam-tools">
            <label className="lp-exam-search">
              <Icon name="search" size={16} />
              <input
                type="search"
                value={query}
                onChange={(ev) => setQuery(ev.target.value)}
                placeholder="Search exams, topics or fields"
                aria-label="Search exams"
              />
            </label>
            <div
              className="lp-exam-cats"
              role="group"
              aria-label="Filter by field"
            >
              {categories.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  className={`lp-exam-cat${active === c.name ? " on" : ""}`}
                  aria-pressed={active === c.name}
                  onClick={() => setCategory(c.name)}
                >
                  {c.name}
                  <small>{c.count}</small>
                </button>
              ))}
            </div>
          </div>
        )}

        {state.kind === "ready" &&
          state.exams.length > 0 &&
          shown.length === 0 && (
            <p style={{ textAlign: "center" }}>
              No exams match your search.{" "}
              <button
                type="button"
                className="lp-exam-reset"
                onClick={() => {
                  setQuery("");
                  setCategory("");
                }}
              >
                Clear filters
              </button>
            </p>
          )}

        {state.kind === "ready" && shown.length > 0 && (
          <div className="lp-exams">
            {shown.map((e, i) => (
              <Reveal key={e.code} delay={(i % 3) * 80} className="lp-exam">
                <div className="lp-exam-top">
                  <span className="lp-exam-badge">
                    <Icon name="zap" size={13} />
                    Always open
                  </span>
                  <span className="lp-exam-price">
                    {e.feePaise === 0 ? "Free" : formatInr(e.feePaise)}
                    <small>one attempt</small>
                  </span>
                </div>

                {catOf(e) !== "Other" && (
                  <span className="lp-exam-field">{catOf(e)}</span>
                )}
                <h3 className="lp-exam-title">{e.title}</h3>
                {e.summary && <p className="lp-exam-summary">{e.summary}</p>}

                {e.topics.length > 0 && (
                  <ul className="lp-exam-topics" aria-label="Topics">
                    {e.topics.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                )}

                <dl className="lp-exam-stats">
                  <div>
                    <dt>
                      <Icon name="exams" size={15} />
                      Questions
                    </dt>
                    <dd>{e.questionCount}</dd>
                  </div>
                  <div>
                    <dt>
                      <Icon name="award" size={15} />
                      Marks
                    </dt>
                    <dd>{e.totalMarks}</dd>
                  </div>
                  <div>
                    <dt>
                      <Icon name="timer" size={15} />
                      Time
                    </dt>
                    <dd>
                      {e.durationMinutes}
                      <small> min</small>
                    </dd>
                  </div>
                </dl>

                <a
                  className="btn btn-primary btn-link lp-exam-cta"
                  href={appUrl(`/join/?code=${encodeURIComponent(e.code)}`)}
                >
                  Take this exam
                  <Icon name="arrow" size={16} />
                </a>
                <span className="lp-exam-foot">Pass mark {e.passPercent}%</span>
              </Reveal>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
