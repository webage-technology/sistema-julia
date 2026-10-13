'use client';

import { useEffect } from 'react';

/*
 * Faixa de ambiente: faixa no topo da tela quando o sistema roda em DEV ou STAGE.
 * Em produção não aparece. É o mesmo código em todos os sistemas da casa
 * (original: sistema-base/frontend/app/faixa-ambiente.tsx).
 *
 * Quem decide o ambiente:
 *  1. NEXT_PUBLIC_AMBIENTE ("dev", "stage" ou "producao"), se estiver definida;
 *  2. senão, o endereço: localhost, IP de rede interna, "-dev." ou "dev." = DEV;
 *     "-stage.", "stage." ou "homolog" = STAGE; qualquer outro = produção;
 *  3. servidor de desenvolvimento (next dev / vite) nunca é produção: vira DEV.
 * Não aparece dentro de iframe, em navegador automatizado (Playwright) nem na impressão.
 */

const FAIXA_CORES = {
  dev: { sigla: 'DEV', texto: 'ambiente de desenvolvimento', fundo: '#f59e0b', listra: '#1f2937', letra: '#1f2937' },
  stage: { sigla: 'STAGE', texto: 'ambiente de homologação', fundo: '#7c3aed', listra: '#c4b5fd', letra: '#ffffff' },
};
const FAIXA_ROTULO_OCULTO = 'faixa-ambiente:rotulo-oculto';

// Valor informado à mão (variável de ambiente ou data-ambiente). null = não informado.
function normalizarAmbiente(valor = '') {
  const v = String(valor || '').trim().toLowerCase();
  if (!v || v.charAt(0) === '%') return null; // vazio ou %VITE_AMBIENTE% que o Vite não trocou
  if (['dev', 'development', 'desenvolvimento', 'local'].indexOf(v) >= 0) return 'dev';
  if (['stage', 'staging', 'homolog', 'homologacao', 'homologação', 'hml'].indexOf(v) >= 0) return 'stage';
  return 'producao';
}

// Sem nada informado, o endereço decide (convenção da casa: <sistema>-dev / <sistema>-stage).
function ambienteDoEndereco(endereco = '') {
  const h = endereco.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return 'producao';
  if (h === 'localhost' || h === 'host.docker.internal' || h === '::1' || h === '0.0.0.0') return 'dev';
  if (/\.(localhost|local)$/.test(h)) return 'dev';
  if (/^(127|10)\.\d+\.\d+\.\d+$/.test(h) || /^192\.168\.\d+\.\d+$/.test(h) || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h)) return 'dev';
  if (/(^|[.-])(stage|staging|stg|homolog|homologacao|hml|hmg)([.-]|$)/.test(h)) return 'stage';
  if (/(^|[.-])(dev|desenv|develop|development)([.-]|$)/.test(h)) return 'dev';
  return 'producao';
}

function montarFaixaAmbiente(informado = '', servidorDeDev = false) {
  const nada = () => undefined;
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body) return nada;
  if (window.top !== window.self) return nada; // dentro de iframe quem embute já mostra a sua
  if (navigator.webdriver) return nada; // Playwright/Puppeteer: não entra em print, render nem teste
  const forcado = normalizarAmbiente(informado);
  const peloEndereco = ambienteDoEndereco(window.location.hostname);
  // next dev / vite nunca é produção, mesmo num endereço sem "-dev"
  const ambiente = forcado !== null ? forcado : servidorDeDev && peloEndereco === 'producao' ? 'dev' : peloEndereco;
  if (ambiente !== 'dev' && ambiente !== 'stage') return nada;
  if (document.querySelector('faixa-ambiente')) return nada;

  const cor = FAIXA_CORES[ambiente];
  const host = document.createElement('faixa-ambiente');
  host.setAttribute('data-ambiente', ambiente);
  host.style.cssText =
    'all:initial;display:block;position:fixed;top:0;left:0;right:0;height:0;z-index:2147483647;pointer-events:none';
  const raiz = host.attachShadow({ mode: 'open' });
  raiz.innerHTML =
    '<style>' +
    '.faixa{position:fixed;top:0;left:0;right:0;height:4px;pointer-events:none;' +
    'background:repeating-linear-gradient(135deg,' + cor.fundo + ' 0 10px,' + cor.listra + ' 10px 20px);' +
    'box-shadow:0 1px 3px rgba(0,0,0,.3)}' +
    '.rotulo{position:fixed;top:4px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:6px;' +
    'padding:1px 10px 3px;border-radius:0 0 7px 7px;background:' + cor.fundo + ';color:' + cor.letra + ';' +
    'font:500 11px/16px ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;white-space:nowrap;' +
    'box-shadow:0 2px 6px rgba(0,0,0,.3);pointer-events:auto;cursor:pointer;user-select:none;transition:opacity .15s}' +
    '.rotulo:hover{opacity:.35}' +
    '.rotulo b{font-weight:800;letter-spacing:.08em}' +
    '.rotulo[hidden]{display:none}' +
    '@media print{.faixa,.rotulo{display:none}}' +
    '</style>' +
    '<div class="faixa"></div>' +
    '<div class="rotulo" title="Clique para esconder o aviso nesta aba (a faixa continua)">' +
    '<b>' + cor.sigla + '</b><span>' + cor.texto + '</span></div>';

  const rotulo = raiz.querySelector('.rotulo');
  if (rotulo) {
    try {
      if (window.sessionStorage.getItem(FAIXA_ROTULO_OCULTO) === '1') rotulo.setAttribute('hidden', '');
    } catch {
      // sem sessionStorage (aba anônima bloqueada): o rótulo só não lembra
    }
    rotulo.addEventListener('click', () => {
      rotulo.setAttribute('hidden', '');
      try {
        window.sessionStorage.setItem(FAIXA_ROTULO_OCULTO, '1');
      } catch {
        // idem: esconde só até recarregar
      }
    });
  }

  document.body.appendChild(host);
  // Se alguém trocar o conteúdo do <body>, a faixa volta.
  const vigia = new MutationObserver(() => {
    if (!host.isConnected && document.body) document.body.appendChild(host);
  });
  vigia.observe(document.body, { childList: true });
  return () => {
    vigia.disconnect();
    host.remove();
  };
}

export default function FaixaAmbiente() {
  useEffect(
    () => montarFaixaAmbiente(process.env.NEXT_PUBLIC_AMBIENTE, process.env.NODE_ENV === 'development'),
    [],
  );
  return null;
}
