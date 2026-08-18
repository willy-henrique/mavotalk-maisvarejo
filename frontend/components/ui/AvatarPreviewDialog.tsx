import React, { useState } from 'react';
import { Dialog } from './Dialog';

type AvatarPreviewDialogProps = {
  avatarUrl: string;
  contactName: string;
  onClose: () => void;
};

export function AvatarPreviewDialog({
  avatarUrl,
  contactName,
  onClose,
}: AvatarPreviewDialogProps) {
  const [failed, setFailed] = useState(false);

  return (
    <Dialog
      title={`Foto de ${contactName || 'Contato'}`}
      description="Visualização ampliada da foto de perfil do WhatsApp."
      onClose={onClose}
      size="wide"
    >
      <div className="flex min-h-72 items-center justify-center bg-slate-100 p-4 sm:p-8 dark:bg-slate-950/50">
        {failed ? (
          <p role="alert" className="text-center text-sm font-medium text-slate-500 dark:text-slate-400">
            A foto não está mais disponível no WhatsApp.
          </p>
        ) : (
          <img
            src={avatarUrl}
            alt={`Foto de perfil de ${contactName || 'Contato'}`}
            referrerPolicy="no-referrer"
            className="max-h-[72vh] max-w-full rounded-2xl object-contain shadow-xl"
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </Dialog>
  );
}
