import React, { useState } from 'react';
import { Ticket } from '../types';
import { mockRemoteAccess } from '../services/mockData';
import { Icons } from '../constants';

export type RemoteAccessEntry = {
  id: string;
  platform: string;
  accessId: string;
  passwordCrypted: string;
  ticketId: string;
};

const PLATFORMS = ['AnyDesk', 'TeamViewer', 'RDP', 'Outro'];

const Vault: React.FC<{ tickets: Ticket[] }> = () => {
  const [entries, setEntries] = useState<RemoteAccessEntry[]>(mockRemoteAccess);
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, boolean>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [newPlatform, setNewPlatform] = useState(PLATFORMS[0]);
  const [newAccessId, setNewAccessId] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newTicketRef, setNewTicketRef] = useState('');

  const toggleReveal = (id: string) => {
    setRevealedPasswords((prev) => {
      const isRevealing = !prev[id];
      if (isRevealing) {
        console.log(`Auditoria Vault: Credencial ${id} visualizada às ${new Date().toLocaleTimeString()}`);
      }
      return { ...prev, [id]: isRevealing };
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('Copiado para a área de transferência!');
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccessId.trim()) return;
    const id = 'ra-' + Date.now();
    setEntries((prev) => [
      ...prev,
      {
        id,
        platform: newPlatform,
        accessId: newAccessId.trim(),
        passwordCrypted: newPassword.trim() || '—',
        ticketId: newTicketRef.trim() || '—',
      },
    ]);
    setNewAccessId('');
    setNewPassword('');
    setNewTicketRef('');
    setNewPlatform(PLATFORMS[0]);
    setShowAdd(false);
  };

  return (
    <div className="p-8 flex-1 overflow-y-auto bg-slate-50">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Cofre de Acessos Remotos</h1>
          <p className="text-slate-500">Gerencie credenciais AnyDesk, TeamViewer e RDP. Adicione novos acessos abaixo.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 flex items-center gap-2"
        >
          <span className="text-lg leading-none">+</span>
          Adicionar acesso remoto
        </button>
      </div>

      {showAdd && (
        <div className="mb-6 bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-lg font-bold text-slate-800 mb-4">Novo acesso remoto</h2>
          <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Plataforma</label>
              <select
                value={newPlatform}
                onChange={(e) => setNewPlatform(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none"
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">ID de acesso</label>
              <input
                type="text"
                required
                value={newAccessId}
                onChange={(e) => setNewAccessId(e.target.value)}
                placeholder="Ex: 122 933 455 ou IP"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Senha</label>
              <input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Opcional"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Ticket ref.</label>
              <input
                type="text"
                value={newTicketRef}
                onChange={(e) => setNewTicketRef(e.target.value)}
                placeholder="Ex: TKT-1001"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div className="sm:col-span-2 flex gap-2">
              <button type="submit" className="px-4 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700">
                Salvar
              </button>
              <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-bold">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Plataforma</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">ID de Acesso</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Senha</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Ticket Ref</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map((acc) => (
              <tr key={acc.id} className="hover:bg-slate-50/80 transition-all">
                <td className="px-6 py-4">
                  <span className="px-2 py-1 bg-slate-100 rounded text-[10px] font-bold text-slate-600 uppercase">
                    {acc.platform}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-slate-700">{acc.accessId}</span>
                    <button type="button" onClick={() => copyToClipboard(acc.accessId)} className="text-slate-400 hover:text-blue-600">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                      </svg>
                    </button>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-slate-700">
                      {revealedPasswords[acc.id] ? acc.passwordCrypted : '••••••••'}
                    </span>
                    <button type="button" onClick={() => toggleReveal(acc.id)} className="text-slate-400 hover:text-blue-600">
                      {revealedPasswords[acc.id] ? (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.43 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="text-xs text-blue-600 hover:underline cursor-pointer font-bold">#{String(acc.ticketId).slice(0, 8)}</span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button type="button" className="text-slate-400 hover:text-slate-600 transition-all p-2">
                    <Icons.Settings className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="bg-slate-50 p-4 border-t border-slate-100 flex justify-between items-center text-xs text-slate-400">
          <p>Exibindo {entries.length} registros</p>
          <div className="flex gap-1 items-center">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Logs de auditoria ativos</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Vault;
