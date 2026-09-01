type Props = {
  secondsLeft: number;
  totalSeconds: number;
  size?: number;
};

/** A circular countdown — fills clockwise as a window's remaining time drains, turning red in its closing seconds. */
export default function CountdownRing({ secondsLeft, totalSeconds, size = 34 }: Props) {
  const clamped = Math.max(0, Math.min(1, totalSeconds > 0 ? secondsLeft / totalSeconds : 0));
  const urgent = secondsLeft > 0 && secondsLeft <= 15;
  const radius = size / 2 - 3;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={`countdown-ring ${urgent ? "urgent" : ""}`}>
      <circle cx={size / 2} cy={size / 2} r={radius} className="ring-track" strokeWidth={3} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        className="ring-fill"
        strokeWidth={3}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
