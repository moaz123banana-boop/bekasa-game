const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const WORDS = {
  "حيوانات": ["بقرة","أسد","فيل","قطة","كلب","حصان","زرافة","قرد","نمر","دب","أرنب","دجاجة","سمكة","فراشة","ذئب"],
  "أكلات": ["بيتزا","برجر","كشري","ملوخية","فول","كباب","بطاطس","مكرونة","شاورما","محشي","فطير","سمك","أرز","كنافة"],
  "فواكه": ["تفاح","موز","برتقال","مانجو","بطيخ","فراولة","عنب","رمان","خوخ","كمثرى","أناناس","جوافة"],
  "دول": ["مصر","اليابان","البرازيل","فرنسا","إيطاليا","الهند","كندا","المغرب","السعودية","تركيا","ألمانيا","إسبانيا"],
  "مدن": ["القاهرة","الإسكندرية","دبي","باريس","لندن","طوكيو","روما","الرياض","إسطنبول","نيويورك"],
  "أفلام": ["تايتانيك","أفاتار","جوكر","ماتريكس","روكي","إنسبشن","كوكو","شريك","باتمان","سبايدرمان"],
  "ألعاب": ["ماينكرافت","فري فاير","ببجي","فورتنايت","روبلوكس","فيفا","ماريو","تتريس","فالورانت","جتا"],
  "رياضة": ["كرة القدم","كرة السلة","التنس","السباحة","الملاكمة","الجري","الطائرة","الجمباز","ركوب الخيل"],
  "سيارات": ["بي إم دبليو","مرسيدس","تويوتا","لامبورجيني","فيراري","تسلا","فورد","نيسان","هوندا"],
  "ملابس": ["قميص","بنطلون","جاكيت","فستان","حذاء","قبعة","جورب","تيشيرت","بدلة"],
  "مهن": ["طبيب","مهندس","مدرس","طيار","شرطي","مصور","نجار","طباخ","مبرمج","محامي"],
  "أماكن": ["مدرسة","مطار","مستشفى","مزرعة","شاطئ","مطعم","سينما","حديقة","مكتبة"],
  "أجهزة": ["هاتف","لابتوب","تلفزيون","سماعة","ساعة ذكية","كاميرا","تابلت","بلايستيشن"],
  "أشياء": ["كرسي","كتاب","مفتاح","مظلة","زجاجة","حقيبة","ساعة","قلم","مصباح"],
  "طبيعة": ["شجرة","جبل","نهر","بحر","صحراء","مطر","ثلج","بركان","جزيرة"]
};

const cleanName = n => String(n || "لاعب").trim().slice(0, 20) || "لاعب";
const makeCode = () => {
  let code;
  do code = crypto.randomBytes(3).toString("hex").toUpperCase();
  while (rooms.has(code));
  return code;
};
const publicPlayers = room => room.players.map(p => ({
  id:p.id, name:p.name, connected:p.connected
}));

function emitLobby(room) {
  io.to(room.code).emit("lobby", {
    code: room.code,
    hostId: room.hostId,
    players: publicPlayers(room),
    settings: room.settings
  });
}

function secretFor(room, socketId) {
  const p = room.players.find(x => x.id === socketId);
  if (!p) return null;
  return {
    isImpostor: room.impostors.includes(socketId),
    category: room.category,
    word: room.impostors.includes(socketId) ? null : room.secretWord
  };
}

function pickImpostors(players, count) {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map(p => p.id);
}

function pickWord(category) {
  const list = category === "عشوائي"
    ? Object.values(WORDS).flat()
    : (WORDS[category] || WORDS["حيوانات"]);
  return list[Math.floor(Math.random() * list.length)];
}

function broadcastSecret(room) {
  room.players.forEach(p => {
    io.to(p.id).emit("role", secretFor(room, p.id));
  });
}

function startTurn(room) {
  if (room.turnIndex >= room.players.length) return startVoting(room);
  room.state = "PLAYING";
  room.currentPlayerId = room.players[room.turnIndex].id;
  room.turnEndsAt = Date.now() + room.settings.turnSeconds * 1000;
  io.to(room.code).emit("turn", {
    currentPlayerId: room.currentPlayerId,
    turnEndsAt: room.turnEndsAt,
    turnIndex: room.turnIndex
  });
}

function startVoting(room) {
  room.state = "VOTING";
  room.votes = new Map();
  room.voteEndsAt = Date.now() + room.settings.voteSeconds * 1000;
  io.to(room.code).emit("voting", {
    players: publicPlayers(room),
    voteEndsAt: room.voteEndsAt
  });
}

function finishVoting(room) {
  if (room.state !== "VOTING") return;
  const counts = {};
  room.players.forEach(p => counts[p.id] = 0);
  for (const target of room.votes.values()) if (counts[target] !== undefined) counts[target]++;

  const max = Math.max(...Object.values(counts), 0);
  const tied = Object.keys(counts).filter(id => counts[id] === max);
  const selectedId = tied.length === 1 && max > 0 ? tied[0] : null;
  const found = selectedId && room.impostors.includes(selectedId);

  room.state = "REVEAL";
  room.lastVote = { counts, selectedId, found, tied };
  io.to(room.code).emit("reveal", {
    counts,
    selectedId,
    selectedName: selectedId ? room.players.find(p => p.id === selectedId)?.name : null,
    found,
    tied: tied.map(id => room.players.find(p => p.id === id)?.name).filter(Boolean),
    impostorNames: room.impostors.map(id => room.players.find(p => p.id === id)?.name).filter(Boolean),
    word: room.secretWord,
    guessEnabled: room.settings.guessEnabled
  });

  if (found && room.settings.guessEnabled) {
    room.state = "IMPOSTOR_GUESS";
    room.guessEndsAt = Date.now() + 30000;
    const impostor = room.impostors.find(id => id === selectedId);
    if (impostor) io.to(impostor).emit("guess", {
      wordCategory: room.category,
      guessEndsAt: room.guessEndsAt
    });
    setTimeout(() => finishGuess(room, null), 30000);
  } else {
    applyRoundScore(room, found ? "players" : "impostor");
    setTimeout(() => nextRound(room), 4500);
  }
}

function finishGuess(room, guess) {
  if (room.state !== "IMPOSTOR_GUESS") return;
  const correct = guess && guess.trim().toLowerCase() === room.secretWord.trim().toLowerCase();
  room.lastGuess = { guess, correct };
  io.to(room.code).emit("guessResult", {
    guess: guess || null, correct, word: room.secretWord,
    impostorNames: room.impostors.map(id => room.players.find(p => p.id === id)?.name).filter(Boolean)
  });
  applyRoundScore(room, correct ? "impostorGuess" : "players");
  setTimeout(() => nextRound(room), 4000);
}

function applyRoundScore(room, winner) {
  room.players.forEach(p => {
    if (winner === "players") {
      if (!room.impostors.includes(p.id)) p.score += 100;
    } else if (winner === "impostor" || winner === "impostorGuess") {
      if (room.impostors.includes(p.id)) p.score += winner === "impostorGuess" ? 175 : 100;
    }
  });
}

function nextRound(room) {
  if (!rooms.has(room.code)) return;
  room.round++;
  if (room.round > room.settings.rounds) {
    room.state = "GAME_RESULT";
    io.to(room.code).emit("gameResult", {
      players: [...room.players].sort((a,b)=>b.score-a.score).map(p => ({id:p.id,name:p.name,score:p.score}))
    });
    return;
  }
  beginRound(room);
}

function beginRound(room) {
  room.state = "STARTING";
  room.category = room.settings.category === "عشوائي"
    ? Object.keys(WORDS)[Math.floor(Math.random() * Object.keys(WORDS).length)]
    : room.settings.category;
  room.secretWord = pickWord(room.category);
  room.impostors = pickImpostors(room.players, room.settings.impostors);
  room.turnIndex = 0;
  room.currentPlayerId = null;
  room.votes = new Map();

  io.to(room.code).emit("starting", { round: room.round, totalRounds: room.settings.rounds });
  setTimeout(() => {
    if (!rooms.has(room.code)) return;
    room.state = "ROLE_REVEAL";
    broadcastSecret(room);
    io.to(room.code).emit("roundInfo", { round: room.round, totalRounds: room.settings.rounds, category: room.category });
    setTimeout(() => startTurn(room), 4000);
  }, 3000);
}

io.on("connection", socket => {
  socket.on("createRoom", ({name, settings}, cb) => {
    const code = makeCode();
    const player = {id:socket.id,name:cleanName(name),score:0,connected:true};
    const safe = {
      rounds: Math.min(Math.max(Number(settings?.rounds)||5,1),10),
      impostors: Math.min(Math.max(Number(settings?.impostors)||1,1),3),
      turnSeconds: [30,60,90,120,180].includes(Number(settings?.turnSeconds)) ? Number(settings.turnSeconds) : 60,
      voteSeconds: [15,30,45,60].includes(Number(settings?.voteSeconds)) ? Number(settings.voteSeconds) : 30,
      category: settings?.category || "عشوائي",
      guessEnabled: settings?.guessEnabled !== false,
      maxPlayers: Math.min(Math.max(Number(settings?.maxPlayers)||10,3),10)
    };
    const room = {
      code, hostId:socket.id, players:[player], state:"LOBBY", round:0,
      settings:safe, category:null, secretWord:null, impostors:[], votes:new Map()
    };
    rooms.set(code,room);
    socket.join(code);
    socket.data.roomCode=code;
    cb({ok:true,code});
    emitLobby(room);
  });

  socket.on("joinRoom", ({code,name}, cb) => {
    const room = rooms.get(String(code||"").trim().toUpperCase());
    if (!room) return cb({ok:false,error:"الغرفة غير موجودة"});
    if (room.state !== "LOBBY") return cb({ok:false,error:"الجولة بدأت بالفعل"});
    if (room.players.length >= room.settings.maxPlayers) return cb({ok:false,error:"الغرفة ممتلئة"});
    if (room.players.some(p=>p.name.toLowerCase()===cleanName(name).toLowerCase()))
      return cb({ok:false,error:"الاسم مستخدم داخل الغرفة"});
    room.players.push({id:socket.id,name:cleanName(name),score:0,connected:true});
    socket.join(room.code);
    socket.data.roomCode=room.code;
    cb({ok:true,code:room.code});
    emitLobby(room);
  });

  socket.on("startGame", ({code}, cb) => {
    const room=rooms.get(code);
    if (!room) return cb?.({ok:false,error:"الغرفة غير موجودة"});
    if (room.hostId !== socket.id) return cb?.({ok:false,error:"فقط صاحب الغرفة يستطيع البدء"});
    if (room.players.length < 3) return cb?.({ok:false,error:"تحتاج اللعبة إلى 3 لاعبين على الأقل"});
    if (room.settings.impostors >= room.players.length) return cb?.({ok:false,error:"عدد البِكِس كبير جدًا"});
    room.players.forEach(p=>p.score=0);
    room.round=1;
    beginRound(room);
    cb?.({ok:true});
  });

  socket.on("chat", ({code,message}, cb) => {
    const room=rooms.get(code);
    if (!room || !room.players.some(p=>p.id===socket.id)) return;
    let text=String(message||"").trim().slice(0,250);
    if (!text) return;
    if (room.secretWord && room.settings.guessEnabled && text.toLowerCase()===room.secretWord.toLowerCase()) {
      return cb?.({ok:false,error:"لا يمكنك كتابة الكلمة السرية"});
    }
    io.to(code).emit("chat",{name:room.players.find(p=>p.id===socket.id)?.name,text});
    cb?.({ok:true});
  });

  socket.on("vote", ({code,targetId}, cb) => {
    const room=rooms.get(code);
    if (!room || room.state!=="VOTING") return cb?.({ok:false,error:"التصويت غير متاح"});
    if (!room.players.some(p=>p.id===socket.id) || !room.players.some(p=>p.id===targetId))
      return cb?.({ok:false,error:"تصويت غير صالح"});
    room.votes.set(socket.id,targetId);
    cb?.({ok:true});
    if (room.votes.size >= room.players.length) finishVoting(room);
  });

  socket.on("guess", ({code,guess}, cb) => {
    const room=rooms.get(code);
    if (!room || room.state!=="IMPOSTOR_GUESS" || !room.impostors.includes(socket.id))
      return cb?.({ok:false,error:"لا يمكنك التخمين الآن"});
    finishGuess(room,String(guess||""));
    cb?.({ok:true});
  });

  socket.on("leaveRoom", ({code}) => {
    socket.leave(code);
    socket.data.roomCode=null;
    const room=rooms.get(code);
    if (!room) return;
    room.players=room.players.filter(p=>p.id!==socket.id);
    if (room.hostId===socket.id) room.hostId=room.players[0]?.id || null;
    if (!room.players.length) rooms.delete(code);
    else emitLobby(room);
  });

  socket.on("disconnect", () => {
    const code=socket.data.roomCode;
    const room=rooms.get(code);
    if (!room) return;
    const p=room.players.find(x=>x.id===socket.id);
    if (p) p.connected=false;
    setTimeout(()=>{
      const r=rooms.get(code);
      if (!r) return;
      const still=r.players.find(x=>x.id===socket.id);
      if (still && !still.connected) {
        r.players=r.players.filter(x=>x.id!==socket.id);
        if (r.hostId===socket.id) r.hostId=r.players[0]?.id || null;
        if (!r.players.length) rooms.delete(code); else emitLobby(r);
      }
    },15000);
    emitLobby(room);
  });
});

setInterval(()=>{
  const now=Date.now();
  for (const room of rooms.values()) {
    if (room.state==="PLAYING" && room.turnEndsAt<=now) {
      room.turnIndex++;
      startTurn(room);
    }
    if (room.state==="VOTING" && room.voteEndsAt<=now) finishVoting(room);
    if (room.state==="IMPOSTOR_GUESS" && room.guessEndsAt<=now) finishGuess(room,null);
  }
},250);

server.listen(PORT,()=>console.log(`Bekasa running on port ${PORT}`));