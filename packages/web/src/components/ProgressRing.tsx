import { stagesWithin } from '@fastr/shared';

/**
 * The timer's progress ring.
 *
 * SVG rather than a CSS conic gradient, because the stage markers need to sit at exact angles on the track
 * and a gradient cannot carry them.
 *
 * `aria-hidden`, deliberately. Everything here is stated as text beside it, and a screen reader reading out
 * a redrawn ring every second would be unusable. Requirement 19.2 asks for announcements at useful moments,
 * which is what the live region next to this does instead.
 */
export function ProgressRing({
  fraction,
  goalMinutes,
  children,
}: {
  /** 0 to 1. Values above 1 are clamped: past the goal the ring is full and the text takes over. */
  fraction: number;
  goalMinutes: number;
  children?: React.ReactNode;
}) {
  const size = 240;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  const clamped = Math.max(0, Math.min(1, fraction));
  const dash = circumference * clamped;

  const markers = stagesWithin(goalMinutes);

  return (
    <div className="ring">
      <svg
        className="ring__svg"
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        focusable="false"
      >
        {/* Rotated so zero is at the top, which is where a clock starts. */}
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--ring-track)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--ring-fill)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference - dash}`}
          />

          {/* Requirement 6.3. A tick on the track wherever a stage boundary falls inside the goal. */}
          {markers.map((stage) => {
            const angle = (stage.atMinutes / goalMinutes) * 2 * Math.PI;
            const inner = radius - stroke / 2;
            const outer = radius + stroke / 2;
            const cx = size / 2;
            const cy = size / 2;
            return (
              <line
                key={stage.key}
                x1={cx + inner * Math.cos(angle)}
                y1={cy + inner * Math.sin(angle)}
                x2={cx + outer * Math.cos(angle)}
                y2={cy + outer * Math.sin(angle)}
                stroke="var(--bg)"
                strokeWidth={2}
              />
            );
          })}
        </g>
      </svg>

      <div className="ring__content">{children}</div>
    </div>
  );
}
