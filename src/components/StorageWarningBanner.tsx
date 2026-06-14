import { Link } from 'react-router-dom'
import { useRaxData } from '../context/RaxDataContext'

export default function StorageWarningBanner() {
  const { storageReady, storageWarning } = useRaxData()

  if (!storageReady || !storageWarning) return null

  return (
    <div className="storage-warning-banner" role="status">
      <p>
        <strong>Your collection is not fully saved in this browser.</strong> {storageWarning}{' '}
        <Link to="/dashboard">Open Dashboard</Link>
      </p>
    </div>
  )
}
