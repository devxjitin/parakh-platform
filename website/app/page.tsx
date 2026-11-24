'use client';

import { PRICING, appUrl, formatInr } from '../lib/config';
import { Icon, type IconName } from '../components/icons';
import { CertificateCheck } from '../components/certificate-check';
import { Reveal } from '../components/reveal';
import { LandingFrame } from '../components/landing-frame';

const TRUST: { icon: IconName; title: string; text: string }[] = [
  { icon: 'layers', title: 'Plan the whole paper', text: 'Question types, marks and schedule' },
  { icon: 'shield', title: 'Proctored', text: 'Full-screen and tab-switch strikes' },
  { icon: 'zap', title: 'Auto-graded', text: 'Choice answers marked instantly' },
  { icon: 'qr', title: 'Verifiable', text: 'Serial number and QR on every certificate' },
];

const FEATURES: { icon: IconName; tone: string; title: string; text: string }[] = [
  {
    icon: 'layers',
    tone: 'indigo',
    title: 'Plan the paper first',
    text: 'Choose the question types, how many of each and the marks per question. Parakh keeps the total marks in step with your plan and tells you what is still missing.',
  },
  {
    icon: 'sparkles',
    tone: 'violet',
    title: 'Three ways to add questions',
    text: 'Write them one by one, paste many at once from plain text, or describe the paper and get a ready-made prompt for ChatGPT, Gemini or Claude. Nothing is added until you have checked it.',
  },
  {
    icon: 'shield',
    tone: 'blue',
    title: 'Fair, proctored exams',
    text: 'Full-screen mode, tab-switch warnings that you set to warn or auto-submit, shuffled questions and options, and a violation timeline for every attempt.',
  },
  {
    icon: 'zap',
    tone: 'sky',
    title: 'Grading and results',
    text: 'Choice questions are marked the moment a student submits. Mark written answers yourself, fix an answer key later, give extra time to one student and publish results when you are ready.',
  },
  {
    icon: 'join',
    tone: 'emerald',
    title: 'Join without an account',
    text: 'Students enter the exam code, their name and email, and confirm with a one-time code. A live waiting room then starts the exam by itself at the scheduled time.',
  },
  {
    icon: 'award',
    tone: 'gold',
    title: 'Verified certificates',
    text: 'A clean, modern certificate with a serial number and a QR code anyone can check online. Add your own logo, or it carries the NandiVex Technologies mark.',
  },
];

const TRAINER_STEPS = [
  {
    title: 'Plan the paper',
    text: 'Pick the question types, counts and marks, then set the start time and duration.',
  },
  {
    title: 'Add the questions',
    text: 'Write them, paste them as text or build the paper with the AI prompt.',
  },
  {
    title: 'Publish and share the code',
    text: 'Pay once to publish, then share the exam code or link with your students.',
  },
  {
    title: 'Grade and certify',
    text: 'Mark written answers, publish results and approve the certificates.',
  },
];

const STUDENT_STEPS = [
  {
    title: 'Join with the exam code',
    text: 'Enter the code, your name and email, and confirm with a one-time code. No account to create.',
  },
  {
    title: 'Wait in the lobby, then begin',
    text: 'A full-screen countdown starts your exam automatically on time. Every answer is saved as you go.',
  },
  {
    title: 'Get your result and certificate',
    text: 'Your score, answer key and certificate arrive by email, right after you submit for choice-only exams.',
  },
];

const STATS: { value: string; label: string }[] = [
  { value: '3', label: 'question types in one paper' },
  { value: '0', label: 'accounts students need to create' },
  { value: '1', label: 'QR code on every certificate' },
];

export default function HomePage() {
  return (
    <LandingFrame>
      {/* ---------- hero ---------- */}
      <section className="lp-hero">
        <div className="lp-hero-glow" aria-hidden="true" />
        <div className="lp-container lp-hero-grid">
          <div className="lp-hero-copy">
            <span className="lp-pill" style={{ ['--d' as string]: '0ms' }}>
              <Icon name="badge" size={14} />
              Verified online assessments &amp; certificates
            </span>
            <h1 style={{ ['--d' as string]: '80ms' }}>
              Run exams <br />
              <span className="lp-grad-text">you can trust.</span>
            </h1>
            <p className="lp-lead" style={{ ['--d' as string]: '160ms' }}>
              Plan a paper, add questions by hand, paste or with AI, and run a proctored exam that
              grades itself. Every certificate carries a serial number and a QR code anyone can
              verify. Trainers publish an exam for {formatInr(PRICING.EXAM_CREATION_PAISE)}.
              Students join with an exam code for {formatInr(PRICING.EXAM_JOIN_PAISE)}.
            </p>
            <div className="lp-cta" style={{ ['--d' as string]: '240ms' }}>
              <a className="btn btn-light btn-lg btn-link" href={appUrl('/register/')}>
                Create a trainer account
                <Icon name="arrow" size={18} />
              </a>
              <a className="btn btn-glass btn-lg btn-link" href={appUrl('/join/')}>
                Join an exam
              </a>
            </div>
            <ul className="lp-checks" style={{ ['--d' as string]: '320ms' }}>
              <li>
                <Icon name="check" size={16} /> No account for students
              </li>
              <li>
                <Icon name="check" size={16} /> Tab-switch strikes you control
              </li>
              <li>
                <Icon name="check" size={16} /> Certificates anyone can verify
              </li>
            </ul>
          </div>

          <div className="lp-stage" style={{ ['--d' as string]: '200ms' }} aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="lp-stage-cert"
              src="/samples/certificate-student.png"
              alt=""
              width={1400}
              height={990}
            />
            <div className="lp-mock-card">
              <div className="lp-mock-head">
                <div>
                  <small>Sample exam</small>
                  <b>Cloud Fundamentals</b>
                </div>
                <span className="lp-mock-timer">
                  <Icon name="timer" size={16} /> 42:18
                </span>
              </div>
              <div className="lp-mock-meta">
                <div>
                  <small>Question</small>
                  <b>25 of 40</b>
                  <span className="lp-mock-bar">
                    <i />
                  </span>
                </div>
                <div>
                  <small>Tab switches</small>
                  <b>0 of 3</b>
                </div>
              </div>
              <p className="lp-mock-q">
                <span>Q25</span>
                Which service stores objects with 99.999999999% durability?
              </p>
              <ul className="lp-mock-opts">
                <li>
                  <i>A</i> Block storage volume
                </li>
                <li className="on">
                  <i>B</i> Object storage
                  <Icon name="check" size={18} />
                </li>
                <li>
                  <i>C</i> In-memory cache
                </li>
                <li>
                  <i>D</i> Relational database
                </li>
              </ul>
            </div>
            <span className="lp-chip lp-chip-a">
              <Icon name="zap" size={14} /> Auto-graded
            </span>
            <span className="lp-chip lp-chip-b">
              <Icon name="qr" size={14} /> QR verified
            </span>
          </div>
        </div>
      </section>

      {/* ---------- trust strip ---------- */}
      <section className="lp-trust" aria-label="Highlights">
        <div className="lp-container lp-trust-grid">
          {TRUST.map((t, i) => (
            <Reveal key={t.title} delay={i * 70} className="lp-trust-item">
              <span className="lp-trust-ico">
                <Icon name={t.icon} size={20} />
              </span>
              <div>
                <b>{t.title}</b>
                <span>{t.text}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------- features ---------- */}
      <section className="lp-section" id="features">
        <div className="lp-container">
          <Reveal className="lp-head lp-head-center">
            <span className="lp-eyebrow">Built for exams</span>
            <h2>Everything you need to run an exam you can stand behind.</h2>
            <p>
              From the first question to the certificate in the student&apos;s inbox, one platform
              covers the whole exam.
            </p>
          </Reveal>
          <div className="lp-features">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 80} className="lp-feature">
                <span className={`lp-feature-ico tone-${f.tone}`}>
                  <Icon name={f.icon} size={22} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </Reveal>
            ))}
          </div>
          <Reveal className="lp-stats">
            {STATS.map((s) => (
              <div key={s.label}>
                <b>{s.value}</b>
                <span>{s.label}</span>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ---------- how it works ---------- */}
      <section className="lp-section lp-section-tint" id="how">
        <div className="lp-container">
          <Reveal className="lp-head lp-head-center">
            <span className="lp-eyebrow">How it works</span>
            <h2>Simple for trainers. Calm for students.</h2>
            <p>A few steps on each side, no software to install.</p>
          </Reveal>
          <div className="lp-flows">
            {[
              {
                icon: 'graduation' as IconName,
                title: 'For trainers',
                sub: 'Plan, publish and certify',
                steps: TRAINER_STEPS,
              },
              {
                icon: 'user' as IconName,
                title: 'For students',
                sub: 'Join, take the exam and earn a certificate',
                steps: STUDENT_STEPS,
              },
            ].map((flow, fi) => (
              <Reveal key={flow.title} delay={fi * 100} className="lp-flow">
                <div className="lp-flow-head">
                  <span className="lp-flow-ico">
                    <Icon name={flow.icon} size={22} />
                  </span>
                  <div>
                    <h3>{flow.title}</h3>
                    <p>{flow.sub}</p>
                  </div>
                </div>
                <ol className="lp-steps">
                  {flow.steps.map((s, i) => (
                    <li key={s.title}>
                      <span className="lp-step-n">{i + 1}</span>
                      <div>
                        <b>{s.title}</b>
                        <p>{s.text}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- certificates ---------- */}
      <section className="lp-section" id="certificates" aria-labelledby="samples-title">
        <div className="lp-container">
          <Reveal className="lp-head lp-head-center">
            <span className="lp-pill lp-pill-gold">
              <Icon name="badge" size={14} />
              Verifiable credentials
            </span>
            <h2 id="samples-title">Two certificates, both verifiable</h2>
            <p>
              Every certificate carries a serial number and a QR code. Anyone can check it right
              below, no sign-in needed.
            </p>
          </Reveal>
          <div className="sample-grid">
            <Reveal as="figure" className="sample">
              <div className="sample-frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/samples/certificate-student.png"
                  alt="Sample Certificate of Achievement awarded to a student, with the trainer's logo, the NandiVex Technologies logo, a signature, the date of issue, a serial number and a QR code"
                  width={1404}
                  height={993}
                  loading="lazy"
                />
                <span className="seal" aria-hidden="true">
                  <Icon name="award" size={20} />
                </span>
              </div>
              <figcaption>
                <h3>For students: Certificate of Achievement</h3>
                <p>
                  Awarded when a student passes, with the student&apos;s name, the exam and the
                  score. The trainer&apos;s logo sits beside the NandiVex mark, and without one the
                  NandiVex logo stands alone at the top. Trainers can also give a participation
                  certificate to students below the pass mark.
                </p>
                <a
                  className="link-arrow"
                  href="/samples/certificate-student.pdf"
                  target="_blank"
                  rel="noopener"
                >
                  Open sample (PDF)
                  <Icon name="arrow" size={16} />
                </a>
              </figcaption>
            </Reveal>
            <Reveal as="figure" className="sample" delay={100}>
              <div className="sample-frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/samples/certificate-trainer.png"
                  alt="Sample Certificate of Appreciation awarded to a trainer for conducting an exam, with the NandiVex Technologies logo, a signature, a serial number and a QR code"
                  width={1404}
                  height={993}
                  loading="lazy"
                />
                <span className="seal" aria-hidden="true">
                  <Icon name="badge" size={20} />
                </span>
              </div>
              <figcaption>
                <h3>For trainers: Certificate of Appreciation</h3>
                <p>
                  Awarded to the trainer for conducting an exam, with the number of students who sat
                  it. Signed by NandiVex Technologies.
                </p>
                <a
                  className="link-arrow"
                  href="/samples/certificate-trainer.pdf"
                  target="_blank"
                  rel="noopener"
                >
                  Open sample (PDF)
                  <Icon name="arrow" size={16} />
                </a>
              </figcaption>
            </Reveal>
          </div>
          <div id="verify">
            <Reveal className="lp-verify">
              <div className="lp-verify-text">
                <span className="lp-pill lp-pill-gold">
                  <Icon name="shield" size={14} />
                  Check a certificate
                </span>
                <h3>Is this certificate genuine?</h3>
                <p>
                  Enter the serial number printed on it (or scan its QR code). You see who it was
                  awarded to, for which exam and when. No sign-in needed.
                </p>
              </div>
              <CertificateCheck />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------- pricing ---------- */}
      <section className="lp-section lp-section-tint" id="pricing">
        <div className="lp-container">
          <Reveal className="lp-head lp-head-center">
            <span className="lp-eyebrow">Pricing</span>
            <h2>Pay per exam. Nothing else.</h2>
            <p>No subscription and no set-up fee.</p>
          </Reveal>
          <div className="lp-pricing">
            <Reveal className="lp-price">
              <span className="lp-price-tag">For trainers</span>
              <div className="lp-price-amt">
                {formatInr(PRICING.EXAM_CREATION_PAISE)} <small>per exam</small>
              </div>
              <p className="muted">Publish an exam and share its code with your students.</p>
              <ul>
                <li>
                  <Icon name="check" size={16} /> Single, multiple-choice and written questions
                </li>
                <li>
                  <Icon name="check" size={16} /> Paper plan, bulk import and the AI prompt builder
                </li>
                <li>
                  <Icon name="check" size={16} /> Grading, results and certificates
                </li>
                <li>
                  <Icon name="check" size={16} /> Earnings and payouts dashboard
                </li>
              </ul>
              <a className="btn btn-secondary btn-link" href={appUrl('/register/')}>
                Start as a trainer
              </a>
            </Reveal>
            <Reveal className="lp-price lp-price-hl" delay={100}>
              <span className="lp-price-flag">Students</span>
              <span className="lp-price-tag">For students</span>
              <div className="lp-price-amt">
                {formatInr(PRICING.EXAM_JOIN_PAISE)} <small>per exam</small>
              </div>
              <p>Join with an exam code and earn a verified certificate. No account needed.</p>
              <ul>
                <li>
                  <Icon name="check" size={16} /> A full-screen waiting room that starts the exam
                </li>
                <li>
                  <Icon name="check" size={16} /> A timed exam that saves as you go
                </li>
                <li>
                  <Icon name="check" size={16} /> Score and answer key by email after you submit
                </li>
                <li>
                  <Icon name="check" size={16} /> A verified certificate with a QR code
                </li>
              </ul>
              <a className="btn btn-light btn-link" href={appUrl('/join/')}>
                Join as a student
              </a>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------- final call to action ---------- */}
      <section className="lp-section lp-final">
        <div className="lp-container">
          <Reveal className="lp-banner">
            <h2>Ready to run your next exam?</h2>
            <p>Create an account in a minute, or sign in to pick up where you left off.</p>
            <div className="lp-cta lp-cta-center">
              <a className="btn btn-light btn-lg btn-link" href={appUrl('/register/')}>
                Get started
                <Icon name="arrow" size={18} />
              </a>
              <a className="btn btn-glass btn-lg btn-link" href={appUrl('/login/')}>
                Sign in
              </a>
            </div>
          </Reveal>
        </div>
      </section>
    </LandingFrame>
  );
}
