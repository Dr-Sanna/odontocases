// src/components/Background.jsx
import background from '../assets/background.png'
import './Background.css'

export default function Background({ variant = 'default' }) {
  return (
    <div className={`global-background ${variant === 'home' ? 'home' : 'secondary'}`}>
      <img src={background} alt="background" />
    </div>
  )
}
