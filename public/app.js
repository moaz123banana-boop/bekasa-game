const socket = io();
const $ = id => document.getElementById(id);
let myName="", roomCode="", isHost=false, settings={}, players=[], selectedVote=null, secretRole=null;
let timerInterval=null;

const categories=["عشوائي","حيوانات","أكلات","فواكه","دول","مدن","أفلام","ألعاب","رياضة","سيارات","ملابس","مهن","أماكن","أجهزة","أشياء","طبيعة"];
categories.forEach(c=> $("category").insertAdjacentHTML("beforeend",`<option>${c}</option>`));

function show(id){document.querySelectorAll(".screen").forEach(x=>x.classList.remove("active"));$(id).classList.add("active")}
function goHome(){show("home")}
function showCreate(){if(!getName())return;show("create")}
function showJoin(){if(!getName())return;show("join")}
function showTutorial(){show("tutorial")}
function getName(){const n=$("name").value.trim();if(!n){alert("اكتب اسمك أولًا");return false}myName=n.slice(0,20);return true}
function error(msg){alert(msg)}
function showLobby(){show("lobby");$("codeText").textContent=roomCode;renderPlayers();$("startBtn").classList.toggle("hidden",!isHost)}

function createRoom(){
  if(!getName())return;
  socket.emit("createRoom",{name:myName,settings:{
    maxPlayers:+$("maxPlayers").value,impostors:+$("impostors").value,category:$("category").value,
    turnSeconds:+$("turnSeconds").value,voteSeconds:+$("voteSeconds").value,rounds:+$("rounds").value,
    guessEnabled:$("guessEnabled").checked
  }},res=>{if(!res.ok)return error(res.error);roomCode=res.code;isHost=true;showLobby()});
}

function joinRoom(){
  if(!getName())return;
  const code=$("joinCode").value.trim().toUpperCase();
  socket.emit("joinRoom",{code,name:myName},res=>{if(!res.ok)return error(res.error);roomCode=res.code;isHost=false;showLobby()});
}

function quickJoin(){
  if(!getName())return;
  alert("اكتب كود غرفة من أصدقائك في النسخة الأولى. المطابقة السريعة ستكون في النسخة القادمة.")
}

function copyCode(){
  navigator.clipboard?.writeText(roomCode);
  alert("تم نسخ الكود: "+roomCode)
}

function startGame(){
  socket.emit("startGame",{code:roomCode},res=>{if(res&&!res.ok)error(res.error)})
}

function leaveRoom(){
  socket.emit("leaveRoom",{code:roomCode});
  roomCode="";
  goHome()
}

function backToLobby(){showLobby()}

function renderPlayers(){
  $("players").innerHTML=players.map(p=>`<div class="player"><span>🟢 ${escapeHtml(p.name)} ${p.id===roomCode?"":""}</span><small>${p.id===socket.id?"أنت":(p.id===getHostId()?"👑 صاحب الغرفة":"")}</small></div>`).join("");
}

function getHostId(){return window.hostId}

function escapeHtml(s){
  return s.replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))
}

socket.on("lobby",data=>{
  roomCode=data.code;
  window.hostId=data.hostId;
  isHost=data.hostId===socket.id;
  players=data.players;
  settings=data.settings;
  if($("lobby").classList.contains("active")||$("home").classList.contains("active")===false) showLobby();
  $("lobbyTitle").textContent="الغرفة";
  renderPlayers();
});

socket.on("starting",d=>{
  show("game");
  $("roleCard").innerHTML=`<div class="big">🔥 الجولة بدأت!</div><p>استعد...</p>`;
  $("roundText").textContent=`${d.round}/${d.totalRounds}`
});

socket.on("roundInfo",d=>{
  show("game");
  $("roundText").textContent=`${d.round}/${d.totalRounds}`;
  $("gameCategory").textContent="🏷️ "+d.category;
  $("roleCard").innerHTML=`<div class="big">جاري تجهيز دورك...</div>`;
  $("chat").innerHTML="";
});

socket.on("role",d=>{
  secretRole=d;
  $("roleCard").className="role-card "+(d.isImpostor?"role-bad":"role-good");
  $("roleCard").innerHTML=d.isImpostor
    ? `<div class="big">🔴 أنت البِكِس!</div><p>التصنيف: ${escapeHtml(d.category)}<br>❌ لا توجد كلمة عندك.<br>حاول تعرفها من كلام اللاعبين.</p>`
    : `<div class="big">🟢 أنت لاعب عادي</div><p>التصنيف: ${escapeHtml(d.category)}<br>الكلمة: <b>${escapeHtml(d.word)}</b></p>`;
});

socket.on("turn",d=>{
  clearInterval(timerInterval);
  $("current").textContent=d.currentPlayerId===socket.id?"🎙️ دورك — اتكلم الآن!":"👂 "+(players.find(p=>p.id===d.currentPlayerId)?.name||"لاعب")+" يتحدث...";
  tick(d.turnEndsAt);
});

function tick(end){
  clearInterval(timerInterval);
  const run=()=>{
    const left=Math.max(0,end-Date.now());
    const s=Math.ceil(left/1000);
    $("timer").textContent=`00:${String(s).padStart(2,"0")}`;
    if(left<=0)clearInterval(timerInterval)
  };
  run();
  timerInterval=setInterval(run,250);
}

socket.on("voting",d=>{
  show("voting");
  selectedVote=null;
  $("voteBtn").disabled=false;
  tick(d.voteEndsAt);
  $("voteList").innerHTML=d.players.map(p=>`<div class="vote-item" data-id="${p.id}" onclick="selectVote('${p.id}')">⭕ ${escapeHtml(p.name)}</div>`).join("");
});

function selectVote(id){
  selectedVote=id;
  document.querySelectorAll(".vote-item").forEach(x=>x.classList.toggle("selected",x.dataset.id===id))
}

function confirmVote(){
  if(!selectedVote)return error("اختار لاعبًا أولًا");
  $("voteBtn").disabled=true;
  socket.emit("vote",{code:roomCode,targetId:selectedVote})
}

socket.on("reveal",d=>{
  show("result");
  const lines=Object.entries(d.counts).sort((a,b)=>b[1]-a[1]).map(([id,n])=>`<div class="score-row"><span>${escapeHtml(players.find(p=>p.id===id)?.name||"لاعب")}</span><b>${n}</b></div>`).join("");
  $("resultBox").innerHTML=`<h2>${d.found?"🎯 تم اكتشاف البِكِس!":"😈 البِكِس هرب!"}</h2>
  <p>${d.selectedName?`تم اختيار: <b>${escapeHtml(d.selectedName)}</b>`:"لم يتم اختيار لاعب واحد بسبب التعادل/عدم التصويت."}</p>
  <p>البِكِس: <b>${escapeHtml(d.impostorNames.join("، "))}</b></p><p>الكلمة: <b>${escapeHtml(d.word)}</b></p><hr>${lines}`;
  $("guessBtn").classList.add("hidden");
});

socket.on("guess",d=>{
  show("guess");
  $("guessInput").value="";
  tick(d.guessEndsAt)
});

function showGuess(){show("guess")}

function sendGuess(){
  const g=$("guessInput").value.trim();
  if(!g)return error("اكتب تخمينك");
  socket.emit("guess",{code:roomCode,guess:g})
}

socket.on("guessResult",d=>{
  show("result");
  $("resultBox").innerHTML=`<h2>${d.correct?"🎯 إجابة صحيحة! 🔥":"❌ إجابة خاطئة!"}</h2><p>التخمين: <b>${escapeHtml(d.guess||"لم يخمن")}</b></p><p>الكلمة كانت: <b>${escapeHtml(d.word)}</b></p><p>${d.correct?"🔴 البِكِس فاز بالجولة!":"🟢 اللاعبون يفوزون بالجولة!"}</p>`;
});

socket.on("gameResult",d=>{
  show("final");
  $("finalScores").innerHTML=d.players.map((p,i)=>`<div class="score-row"><span>${i===0?"🥇":i===1?"🥈":i===2?"🥉":"🏅"} ${escapeHtml(p.name)}</span><b>${p.score}</b></div>`).join("");
});

socket.on("chat",m=>{
  $("chat").insertAdjacentHTML("beforeend",`<div class="msg"><b>${escapeHtml(m.name)}:</b> ${escapeHtml(m.text)}</div>`);
  $("chat").scrollTop=$("chat").scrollHeight
});

function sendChat(){
  const i=$("msg");
  const text=i.value.trim();
  if(!text)return;
  socket.emit("chat",{code:roomCode,message:text},res=>{if(res&&!res.ok)error(res.error)});
  i.value=""
}

$("msg").addEventListener("keydown",e=>{
  if(e.key==="Enter")sendChat()
});

socket.on("connect",()=>{
  $("conn").textContent="🟢 متصل"
});

socket.on("disconnect",()=>{
  $("conn").textContent="🔴 غير متصل"
});
