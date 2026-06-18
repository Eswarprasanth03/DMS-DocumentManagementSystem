import { Link } from 'react-router-dom'
import { Button } from '../components/ui.jsx'
import { IconBolt } from '../components/icons.jsx'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-400 to-purple-500 text-white flex items-center justify-center shadow-lg shadow-indigo-500/30">
          <IconBolt className="w-7 h-7" />
        </div>
        <div className="mt-6 text-5xl font-bold text-gray-900">404</div>
        <p className="mt-2 text-sm text-gray-500">This page drifted out of the FlowSphere.</p>
        <Link to="/" className="inline-block mt-6">
          <Button>Back to dashboard</Button>
        </Link>
      </div>
    </div>
  )
}
