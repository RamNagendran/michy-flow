import { Alert, Modal, Typography } from 'antd'
import type { UserWithPassword } from '../../types/auth'

/**
 * Shows a temporary password exactly once. It is not stored anywhere in the app afterwards:
 * closing this dialog drops it from memory.
 */
export default function TemporaryPasswordModal({ result, onClose }: { result: UserWithPassword | null; onClose: () => void }) {
  return (
    <Modal open={!!result} title="Temporary password" okText="Done" onOk={onClose} onCancel={onClose} cancelButtonProps={{ style: { display: 'none' } }} destroyOnHidden>
      {result && (
        <>
          <p>
            Give this password to <b>{result.user.full_name}</b> ({result.user.email}) in person or by phone. They will be asked to choose their own password the first
            time they sign in.
          </p>
          <div style={{ background: '#f7f8fa', borderRadius: 12, padding: '16px 20px', textAlign: 'center', margin: '16px 0' }}>
            <Typography.Text copyable={{ text: result.temporary_password }} style={{ fontSize: 22, fontWeight: 800, letterSpacing: '0.08em' }} className="num">
              {result.temporary_password}
            </Typography.Text>
          </div>
          <Alert type="warning" showIcon title="This is the only time it is shown. Do not send it by email or chat." />
        </>
      )}
    </Modal>
  )
}
