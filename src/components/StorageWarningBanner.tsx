import { Link } from 'react-router-dom'
import { useRaxData } from '../context/RaxDataContext'

export default function StorageWarningBanner() {
  const { storageReady, storageWarning } = useRaxData()

  if (!storageReady || !storageWarning) return null

  return (
    <div className="storage-warning-banner" role="status">
      <p>
        <strong>Collection sync needs attention.</strong> {storageWarning}{' '}
        <Link to="/">Open Dashboard to export a backup</Link>
      </p>
      <button type="button" className="btn-secondary" onClick={() => {
        if (window.confirm('Reloading will replace unsynced local work with your account copy. Export a JSON backup from Dashboard first. Continue?')) {
          window.location.reload()
        }
      }}>Reload from account</button>
    </div>
  )
}
