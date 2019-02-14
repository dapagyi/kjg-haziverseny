var express = require("express");
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var bodyParser = require('body-parser');
var fs = require("fs");

app.set('view engine', 'ejs');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.enable('trust proxy');

var questions = [];
var current = -1;
function qload(){
    questions = [];
    fs.readFileSync("./questions.txt", "utf8").split("\r\n").forEach((elem)=>{
        if(elem.includes(";")){
        var data = elem.split("; ");
        questions.push(data);
        }
    });
    console.log("Kérdések:", questions);
}
qload();

var logname = new Date().toISOString().replace(/:/g,'')./*replace(//g,'').*/slice(0,17);
console.log(logname);

function log(m, file = "log.txt"){
    m = new Date().toLocaleTimeString() + " > " + m;
    console.log(m);
    if (!fs.existsSync('./data')) fs.mkdirSync('./data');
    fs.appendFileSync("./data/"+logname+'-'+file, m + "\n","utf8");
    if (file=="log.txt") io.emit("admin:log", m);
}

var sockets = [];
var scores = {};
var timeback = -1;

io.on("connection", (socket) => {
    //Felhasználó regisztrálása
    var u;
    socket.emit("welcome");
    socket.on("welcome", (data)=>{
        socket.user = data;
        socket.user.sid = socket.id;
        sockets.push(socket.user);
        u = socket.user.name;
        if (!scores.hasOwnProperty(u)) {
            scores[u] = {value: 0, tips: []}
            console.log(scores);
        }
        socket.emit("newquestion", (current == -1) ? "A verseny kezdete után itt fognak megjelenni a kérdések." : questions[current][0]);
        log(u + " csatlakozott.");
        refreshAdmin();
    });

    socket.on("admin:refresh", ()=>{
        refreshAdmin();
    });

    //Kép küldése
    socket.on("admin:sendimg", (url)=>{
        log("Képlink érkezett: " + url);
        io.emit("img", url);
    });

    //Privát üzenet
    socket.on("admin:sendpm", (data)=>{
        log("Privát üzenet: " + JSON.stringify(data));
        io.emit("pm", data);
    });

    //Admin elindítja a visszaszámlálót
    var tin = null;
    socket.on("admin:starttimer", (sec) => {
        if (tin!=null) clearInterval(tin);
        timeback = sec;
        tin = setInterval(function(){
            if (timeback <= 0) {
                io.sockets.emit('inttick', 0);
                timeback = -1; 
                clearInterval(tin);
            }
            else {
                io.sockets.emit('inttick', timeback);
                timeback--;
            }
        }, 1000);
    });

    socket.on("admin:modifyscore", data=>{
        score(data.team, data.score);
    });

    //Az admin új kérdést küld ki
    socket.on("admin:newquestion", (n)=>{
        if ((current + parseInt(n)) >= 0) {
        current = (current + parseInt(n) ) %questions.length;
        log("Új kérdés következik: " + (current +1)+".");
        io.emit("newquestion", questions[current][0] + " (" + questions[current][1] + " pont)");
        timeback = 0;
        for(var i=0; i<Object.keys(scores).length; i++){
            scores[Object.keys(scores)[i]].tips = [];
        }
        refreshAdmin();
        }
    });

    //Egy socket lecsatlakozik
    socket.on("disconnect", ()=>{
        if (typeof socket.user !== "undefined") {
            var index = sockets.indexOf(socket.user);
            if (index !== -1) sockets.splice(index, 1); refreshAdmin();
            log(u + " lecsatlakozott.");
        }
    });
    
    //Új válasz érkezik
    socket.on("newanswer", (data)=> {
        log("Új válasz: " + JSON.stringify(data));
        var r;
        if (current == -1) r = {message: "Várj türelemmel...", class: "text"};
        else if (timeback === -1) r= {message: "Kifutottál az időből.", class: "text-warning"};
        else if (scores[u].tips.includes(questions[current][2])) r = {message: "Már megoldottad ezt a feladatot.", class: "text"};
        else if (scores[u].tips.includes(data.ans)) r = {message: "Ezt már próbáltad! (" + data.ans + ")", class: "text-warning"};
        else if (data.ans != ""){
            scores[u].tips.push(data.ans);
            console.log(data.ans, questions[current][2]);
            if (data.ans == questions[current][2]){
                //jó megoldás
                var p = Math.max(parseInt(questions[current][1])+1-scores[u].tips.length,1);
                score(u, p);
                r = {message: "Helyes megoldás! (+"+ p +" pont)", class: "text-success"};
            }
            else{
                //rossz tipp
                r = {message: "Rossz válasz! (" + data.ans + ")", class: "text-danger"};
            }
        }
        refreshAdmin();
        socket.emit("reply", r);
    });
});

function score(team, points) {
    scores[team].value = scores[team].value + parseInt(points);
    log(team + ": " + points, "score.txt")
    io.emit("score", {team: team, score: scores[team].value});
    refreshAdmin();
}

function refreshAdmin(){
    io.emit("admin:alluser", {sockets: sockets, scores: scores});
}

app.get("/", (req, res) => {
    log("Lekérés: " + req.ip);
    res.render("login", {text: ''});
});

app.get("/admin", (req,res)=> {
    res.render("admin", {questions: questions});
});

app.get("/stats", (req,res)=> {
    res.render("stats", {scores: scores});
});

app.get("/qload", (req,res)=> {
    qload();
    res.send("Kérdések újratöltve.");
});

app.post("/", (req,res) => {
    var d = req.body.name + "; " + req.body.school;
    //log("Csatlakozott (" + req.ip+"): " + d);
    log(d, "users.txt");
    if (req.body.school == "") req.body.school = "unset";
    if (current != -1) req.body.q = questions[current][0] + " (" + questions[current][1] + " pont)";
    res.render("main", req.body);
});

http.listen(80, "0.0.0.0",() => {
    log("A szerver elindult.");
});