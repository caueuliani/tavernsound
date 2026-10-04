'use client'
import { useState } from 'react'
import Link from 'next/link'
import s from './landing.module.css'
const scenes = [
  { name: 'A última taverna', place: 'Uma conversa antes da jornada', file: 'taverna', label: 'Taverna', positions: [{x:'36%',y:'40%'},{x:'59%',y:'54%'},{x:'43%',y:'71%'}] },
  { name: 'Sob a fortaleza', place: 'Todo corredor guarda um segredo', file: 'masmorra', label: 'Masmorra', positions: [{x:'43%',y:'49%'},{x:'57%',y:'49%'},{x:'29%',y:'70%'}] },
  { name: 'O eco das profundezas', place: 'Vozes entre pedra e cristal', file: 'caverna', label: 'Caverna', positions: [{x:'33%',y:'40%'},{x:'49%',y:'43%'},{x:'25%',y:'53%'}] },
]
const players = [
  { name: 'Elara', role: 'Arqueira', color: '#8bbf9b', file: 'arqueira' },
  { name: 'Brom', role: 'Guerreiro', color: '#d7a36d', file: 'guerreiro' },
  { name: 'Nyx', role: 'Maga', color: '#b6a2e0', file: 'maga' },
]
export default function LandingPage() {
  const [selected, setSelected] = useState(0)
  const scene = scenes[selected]
  return <main className={s.page}>
    <a className={s.skip} href="#aventura">Pular para o conteúdo</a>
    <header className={s.header}>
      <Link href="/" className={s.brand} aria-label="TavernSound, início"><span className={s.mark}>TS</span><span>Tavern<span className={s.gold}>Sound</span><small>VIRTUAL TABLETOP</small></span></Link>
      <nav aria-label="Navegação principal"><a href="#experiencia">A experiência</a><a href="#mesas">Explore as mesas</a></nav>
      <Link className={s.navButton} href="/rooms">Vamos jogar ↗</Link>
    </header>
    <section className={s.hero} id="aventura">
      <div><p className={s.eyebrow}>✦ SUA PRÓXIMA HISTÓRIA COMEÇA AQUI</p><h1>Uma mesa.<br />Mil histórias.<br /><em>Ouça cada uma.</em></h1>
        <p className={s.intro}>Reúna seu grupo, abra o mapa e entre na aventura. Um tabletop virtual onde a posição dos personagens também faz parte da conversa.</p>
        <div className={s.actions}><Link className={s.primary} href="/rooms">Entrar na aventura <span>↗</span></Link><a className={s.secondary} href="#mesas">Conhecer as mesas ↓</a></div>
        <p className={s.beta}>● Em desenvolvimento · acesso de teste por convite</p>
      </div>
      <div className={s.showcase} id="mesas">
        <div className={s.tableHeader}><span>● MESA DE DEMONSTRAÇÃO</span><span>03 AVENTUREIROS</span></div>
        <div className={s.board}>
          <img className={s.map} src={`/maps/${scene.file}.svg`} alt={`Mapa ilustrado: ${scene.label}`} />
          <div className={s.grid} /><div className={s.aura} style={{left:scene.positions[0].x,top:scene.positions[0].y}} />
          {players.map((p,i) => <div key={p.name} className={`${s.token} ${i===0?s.speaking:''}`} style={{left:scene.positions[i].x,top:scene.positions[i].y,borderColor:p.color}}><img src={`/tokens/${p.file}.svg`} alt={`${p.name}, ${p.role}`} /><span className={s.tokenName}>{p.name}{i===0 && <b aria-label="Efeito ilustrativo de fala"> ▂▆▃</b>}</span></div>)}
          <div className={s.sceneCaption}><small>CENÁRIO {String(selected+1).padStart(2,'0')}</small><h2>{scene.name}</h2><p>{scene.place}</p></div><span className={s.compass} aria-hidden="true">N<br />✧</span>
        </div>
        <div className={s.scenePicker} aria-label="Escolha um cenário de demonstração">{scenes.map((item,i)=><button type="button" key={item.file} aria-pressed={selected===i} onClick={()=>setSelected(i)}><span>0{i+1}</span>{item.label}</button>)}</div>
        <p className={s.demoNote}>Prévia ilustrativa: troque o cenário para explorar. O áudio acontece dentro da sala.</p>
      </div>
    </section>
    <section className={s.features} id="experiencia" aria-labelledby="experience-title">
      <div><p className={s.eyebrow}>MENOS DISTÂNCIA. MAIS IMERSÃO.</p><h2 id="experience-title">O cenário também<br />participa da história.</h2><p>Da primeira conversa na taverna ao último encontro na masmorra, dê espaço para a sua campanha acontecer.</p></div>
      <article><span className={s.icon} aria-hidden="true">◎</span><small>01 / PRESENÇA</small><h3>Vozes com lugar</h3><p>Áudio espacial conectado à posição dos personagens. A distância e as barreiras do mapa influenciam o que você ouve.</p></article>
      <article><span className={s.icon} aria-hidden="true">⌘</span><small>02 / CENÁRIOS</small><h3>Uma mesa do seu jeito</h3><p>Importe seu mapa e desenhe paredes, portas e contornos de cavernas para preparar o próximo encontro.</p></article>
      <article><span className={s.icon} aria-hidden="true">✧</span><small>03 / COMPANHIA</small><h3>A história é de vocês</h3><p>O mestre prepara a sala, os jogadores chegam com seus personagens. Tokens, dados e conversa no mesmo lugar.</p></article>
    </section>
    <section className={s.invitation}><div><p className={s.eyebrow}>GUARDE UM LUGAR PARA SEU GRUPO</p><h2>A próxima sessão<br />começa com um convite.</h2></div><div><Link className={s.primary} href="/rooms">Vamos jogar <span>↗</span></Link><p>Entre na sua conta para acessar suas salas.</p></div></section>
    <footer className={s.footer}><span>TavernSound <span className={s.gold}>✧</span> Feito para histórias compartilhadas.</span><span>Uma aventura em construção.</span></footer>
  </main>
}

