import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import './Navbar.css'

export default function Navbar() {
  const [darkMode, setDarkMode] = useState(false)
  const location = useLocation()

  // Applique l'attribut data-theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  const toggleTheme = () => {
    setDarkMode(prev => !prev)
  }

  return (
    <nav className="navbar">
      <div className="navbar-left">
        <Link to="/" className="logo-container">
          <img src="/logo.svg" alt="Logo" className="logo" />
          <span>Dr Sanna</span>
        </Link>

        <div className="nav-links">
          <Link to="/cas-cliniques" className={location.pathname === "/cas-cliniques" ? "active" : ""}>Cas Cliniques</Link>
          <Link to="/randomisation" className={location.pathname === "/randomisation" ? "active" : ""}>Randomisation</Link>
          <Link to="/documentation" className={location.pathname === "/documentation" ? "active" : ""}>Documentation</Link>
          <Link to="/liens-utiles" className={location.pathname === "/liens-utiles" ? "active" : ""}>Liens Utiles</Link>
        </div>
      </div>

      <div className="navbar-right">
        <a
          href="https://github.com/Dr-Sanna"
          target="_blank"
          rel="noopener noreferrer"
          title="Voir sur GitHub"
        >
          <img src="https://cdn-icons-png.flaticon.com/512/25/25231.png" alt="GitHub" className="github-icon" />
        </a>
        <button
          onClick={toggleTheme}
          className="theme-toggle"
          title="Changer le thème"
        >
          {darkMode ? '🌕' : '☀️'}
        </button>
      </div>
    </nav>
  )
}
