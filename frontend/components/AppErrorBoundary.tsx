import React from 'react';

type Props = { children: React.ReactNode };
type State = { hasError: boolean };

/** Evita que uma falha isolada derrube toda a operação do atendente. */
export default class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidUpdate(previousProps: Props) {
    if (this.state.hasError && previousProps.children !== this.props.children) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <section className="flex min-h-full flex-1 items-center justify-center p-6">
        <div className="max-w-md rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-xl shadow-rose-950/5 dark:border-rose-900/50 dark:bg-slate-900">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-xl text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">!</div>
          <h1 className="mt-5 text-lg font-black text-slate-900 dark:text-white">Não foi possível abrir esta área</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">Nenhum dado foi perdido. Atualize a página para tentar novamente.</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-6 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-blue-700">Atualizar página</button>
        </div>
      </section>
    );
  }
}
