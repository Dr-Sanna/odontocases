import './Background.css';

export default function Background({ variant = 'secondary' }) {
  return (
    <div
      className={`global-background ${variant === 'home' ? 'home' : 'secondary'}`}
      aria-hidden="true"
    >
      <img
        src="/background.png"
        alt=""
        loading="eager"
        decoding="sync"
        draggable="false"
      />
    </div>
  );
}
