import snapshotEarnings from './snapshot-earnings.js'

type SnapshotRequest = Parameters<typeof snapshotEarnings>[0]
type SnapshotResponse = Parameters<typeof snapshotEarnings>[1]

export default function handler(
  request: SnapshotRequest,
  response?: SnapshotResponse,
): ReturnType<typeof snapshotEarnings> {
  return snapshotEarnings(request, response)
}
