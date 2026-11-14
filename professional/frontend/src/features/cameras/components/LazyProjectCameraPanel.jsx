import { Suspense, lazy } from 'react'
import { Loader2 } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

// The camera panel is downloaded when its tab is first opened. While it arrives, the
// panel's own "loading" line is shown, so nothing looks different.
const ProjectCameraPanel = lazy(() => import('./ProjectCameraPanel.jsx'))

function CameraPanelLoading() {
  const { t } = useLanguage()
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm font-bold text-oc-muted">
      <Loader2 className="h-4 w-4 animate-spin" /> {t('ui.cctv.loadingProjectCamera')}
    </div>
  )
}

export default function LazyProjectCameraPanel(props) {
  return (
    <Suspense fallback={<CameraPanelLoading />}>
      <ProjectCameraPanel {...props} />
    </Suspense>
  )
}
