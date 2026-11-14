import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, RefreshCw, ScanFace, ShieldCheck } from 'lucide-react'
import { Alert, Spinner } from '../../../shared/ui/ui.jsx'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { submitFaceCapture } from '../../technician/technicianApi.js'

const CAMERA_STARTING = 'Camera is starting. Please wait a moment.'
const CAMERA_STILL_STARTING = 'Camera is still starting. Please wait.'
const CAPTURE_FAILED = 'Unable to capture photo. Please try again.'
const SUBMIT_FAILED = 'Unable to submit face verification. Please try again.'
// Browsers expose the camera only to secure contexts: https://, or http://localhost on the same computer.
const INSECURE_CONTEXT = 'Camera access requires a secure connection. Open this app using localhost on this computer or use the HTTPS Partner development URL.'
const CAMERA_UNSUPPORTED = 'This browser does not support camera access. Open Partner in an up-to-date browser such as Chrome.'

function cameraErrorMessage(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Camera permission was denied. Allow camera permission in your browser and try again.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was detected on this device.'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is being used by another application or could not be accessed.'
    case 'SecurityError':
      return 'Camera access requires HTTPS or localhost.'
    default:
      return 'No camera could be started on this device.'
  }
}

// HTMLMediaElement.HAVE_CURRENT_DATA: a decoded frame exists that drawImage can copy.
const HAVE_CURRENT_DATA = 2

/**
 * Face verification, step 4.
 *
 * Consent comes first; the camera only starts after it. The photo is taken live
 * from the camera (no file picker), sent once over HTTPS, encrypted on the server
 * and kept only until it is reviewed. This screen never claims the face was
 * verified: a submission is PENDING until a reviewer decides.
 */
export default function FaceStep({ onDone }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const mountedRef = useRef(false)
  const [consent, setConsent] = useState(false)
  const [starting, setStarting] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  // True only once the video element holds a real frame; Take photo waits for it.
  const [cameraReady, setCameraReady] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [capture, setCapture] = useState(null) // { blob, url }
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraOn(false)
    setCameraReady(false)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopCamera()
    }
  }, [stopCamera])

  useEffect(() => () => { if (capture?.url) URL.revokeObjectURL(capture.url) }, [capture])

  // The <video> exists only after cameraOn has rendered, so the stream is attached
  // after that commit -- never from a callback that can run before the element mounts.
  useEffect(() => {
    const video = videoRef.current
    const stream = streamRef.current
    if (!cameraOn || !video || !stream) return
    if (video.srcObject !== stream) video.srcObject = stream
    video.play().catch(() => {})
  }, [cameraOn])

  const markReadyWhenFrameAvailable = () => {
    const video = videoRef.current
    if (video && video.readyState >= HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
      setCameraReady(true)
      setMessage((current) => (current === CAMERA_STILL_STARTING ? '' : current))
    }
  }

  const startCamera = async () => {
    if (starting) return
    // On an insecure origin navigator.mediaDevices does not exist: say why instead of trying.
    if (!window.isSecureContext) {
      setMessage(INSECURE_CONTEXT)
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage(CAMERA_UNSUPPORTED)
      return
    }
    setMessage('')
    setStarting(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false })
      // The page may have been left while the permission prompt was open.
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = stream
      setCameraReady(false)
      setCapture(null)
      setCameraOn(true)
    } catch (error) {
      setMessage(cameraErrorMessage(error))
    } finally {
      setStarting(false)
    }
  }

  const takePhoto = () => {
    if (capturing) return
    const video = videoRef.current
    if (!cameraReady || !video || video.readyState < HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      setMessage(CAMERA_STILL_STARTING)
      return
    }
    setMessage('')
    setCapturing(true)
    const failed = () => {
      setMessage(CAPTURE_FAILED)
      setCapturing(false)
    }
    try {
      const width = video.videoWidth
      const height = video.videoHeight
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) {
        failed()
        return
      }
      context.drawImage(video, 0, 0, width, height)
      canvas.toBlob((blob) => {
        if (!mountedRef.current) return
        if (!blob || blob.size === 0) {
          failed()
          return
        }
        // Size only -- the image itself is never logged.
        if (import.meta.env.DEV) console.info(`Face capture created. Size: ${blob.size} bytes`)
        setCapture({ blob, url: URL.createObjectURL(blob) })
        setCapturing(false)
        stopCamera()
      }, 'image/jpeg', 0.9)
    } catch {
      failed()
    }
  }

  const submit = async () => {
    if (!capture || busy) return
    setBusy(true)
    setMessage('')
    try {
      const user = await submitFaceCapture(capture.blob)
      onDone(user)
    } catch (error) {
      // A backend refusal carries a safe, user-facing reason; a request that never got an answer does not.
      setMessage(error?.response ? apiErrorMessage(error, SUBMIT_FAILED) : SUBMIT_FAILED)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-oc-line bg-oc-sunken p-4 text-sm text-oc-ink">
        <p className="flex items-center gap-2 font-extrabold text-oc-deep"><ShieldCheck className="h-4 w-4 text-oc-green" /> How your photo is used</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-oc-muted">
          <li>One live photo is taken with your camera to confirm you are a real person.</li>
          <li>It is encrypted, seen only by a Partner reviewer, and deleted after review (at most 7 days).</li>
          <li>No face template is created, and the photo is never shown to customers.</li>
        </ul>
        <label className="mt-3 flex cursor-pointer items-start gap-2 font-semibold">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-oc-green" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          I agree to face verification as described above.
        </label>
      </div>

      <Alert tone="error">{message}</Alert>

      <div className="relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-2xl border border-oc-line bg-oc-deep">
        {cameraOn && (
          <video
            ref={videoRef}
            className="h-full w-full -scale-x-100 object-cover"
            autoPlay
            playsInline
            muted
            onLoadedMetadata={markReadyWhenFrameAvailable}
            onLoadedData={markReadyWhenFrameAvailable}
            onCanPlay={markReadyWhenFrameAvailable}
          />
        )}
        {cameraOn && !cameraReady && (
          <p role="status" className="pointer-events-none absolute text-center text-sm text-[#b9d8c5]">{CAMERA_STARTING}</p>
        )}
        {!cameraOn && capture && <img src={capture.url} alt="Your captured photo" className="h-full w-full -scale-x-100 object-cover" />}
        {!cameraOn && !capture && (
          <div className="text-center text-[#b9d8c5]">
            <ScanFace className="mx-auto h-14 w-14" />
            <p className="mt-2 text-sm">Centre your face in good light</p>
          </div>
        )}
        {cameraOn && <span className="pointer-events-none absolute inset-[18%] rounded-[45%] border-2 border-dashed border-white/70" />}
      </div>

      <div className="flex flex-wrap gap-2">
        {!cameraOn && !capture && (
          <button type="button" className="btn-primary flex-1" disabled={!consent || starting} onClick={startCamera}>
            <Camera className="h-4 w-4" /> Start camera
          </button>
        )}
        {cameraOn && (
          <button type="button" className="btn-primary flex-1" disabled={!cameraReady || capturing} onClick={takePhoto}>
            {capturing ? <Spinner className="h-4 w-4" /> : <Camera className="h-4 w-4" />} Take photo
          </button>
        )}
        {!cameraOn && capture && (
          <>
            <button type="button" className="btn-ghost flex-1" disabled={busy || starting} onClick={startCamera}>
              <RefreshCw className="h-4 w-4" /> Retake
            </button>
            <button type="button" className="btn-primary flex-1" disabled={busy || !consent} onClick={submit}>
              {busy ? <Spinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />} Submit for verification
            </button>
          </>
        )}
      </div>
    </div>
  )
}
