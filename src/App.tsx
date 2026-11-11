
import { useState } from "react";
import {
  MessageCircle, Phone, Users, CircleDot,
  Settings, Search, Plus, Video, Send,
  Paperclip, Mic, MoreVertical
} from "lucide-react";

const contacts = [
  { name: "Aminata", message: "On se parle ce soir ?", time: "10:42", color: "#a78bfa", online: true },
  { name: "Yao", message: "Merci pour le message !", time: "09:35", color: "#38bdf8", online: true },
  { name: "Sarah", message: "Photo envoyée", time: "Hier", color: "#fb7185", online: false },
  { name: "Karim", message: "À bientôt !", time: "Hier", color: "#34d399", online: false },
  { name: "David", message: "Tu es disponible ?", time: "Lun", color: "#fbbf24", online: false }
];

export default function App() {
  const [active, setActive] = useState("Discussions");
  const [selected, setSelected] = useState("Aminata");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");

  const current = contacts.find(c => c.name === selected)!;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">N<span>✦</span></div>

        <nav>
          {[
            ["Discussions", MessageCircle],
            ["Statuts", CircleDot],
            ["Appels", Phone],
            ["Communautés", Users],
            ["Paramètres", Settings]
          ].map(([name, Icon]: any) => (
            <button
              className={active === name ? "nav active" : "nav"}
              onClick={() => setActive(name)}
              key={name}
              title={name}
            >
              <Icon size={22} />
              <span>{name}</span>
            </button>
          ))}
        </nav>

        <div className="profile">M</div>
      </aside>

      <section className="chats">
        <header>
          <div>
            <h1>NEXORA</h1>
            <small>Connect without limits.</small>
          </div>
          <button className="round"><Plus /></button>
        </header>

        <div className="search">
          <Search size={18} />
          <input
            placeholder="Rechercher une discussion"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <h3>{active}</h3>

        {contacts.filter(c =>
          c.name.toLowerCase().includes(search.toLowerCase())
        ).map(c => (
          <button
            className={"contact " + (selected === c.name ? "selected" : "")}
            onClick={() => setSelected(c.name)}
            key={c.name}
          >
            <div className="avatar" style={{ background: c.color }}>
              {c.name[0]}
              {c.online && <i />}
            </div>
            <div className="contact-info">
              <strong>{c.name}</strong>
              <small>{c.message}</small>
            </div>
            <time>{c.time}</time>
          </button>
        ))}
      </section>

      <section className="conversation">
        <header className="conversation-head">
          <div className="avatar" style={{ background: current.color }}>
            {current.name[0]}
          </div>
          <div className="contact-info">
            <strong>{current.name}</strong>
            <small>{current.online ? "En ligne" : "Hors ligne"}</small>
          </div>
          <button className="round"><Phone /></button>
          <button className="round"><Video /></button>
          <button className="round"><MoreVertical /></button>
        </header>

        <div className="empty-chat">
          <div className="logo-large">N✦</div>
          <h2>NEXORA PRO</h2>
          <p>Vos conversations, en toute simplicité.</p>
        </div>

        <form className="composer" onSubmit={e => {
          e.preventDefault();
          setMessage("");
        }}>
          <button type="button"><Paperclip /></button>
          <input
            placeholder="Écrire un message..."
            value={message}
            onChange={e => setMessage(e.target.value)}
          />
          <button type="button"><Mic /></button>
          <button type="submit"><Send /></button>
        </form>
      </section>
    </div>
  );
}
