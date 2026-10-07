import SceneWorkshop from '../../../components/SceneWorkshop'
export default async function ScenePage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params
  return <SceneWorkshop roomId={roomId} />
}
