const WebSocketServer = new require('ws');
const mysql = require('mysql');
const config = require('./config')

const con = mysql.createConnection(config);
//Если сервер аварийно завершил работу, необходимо удалить данные о прошлых чат-сессиях
con.query(`TRUNCATE chat_user`, function(err){
    if(err) console.log(`Error with TRUNCATE`)
})
// подключенные клиенты
let clients = {};

// WebSocket-сервер на порту 4000
let webSocketServer = new WebSocketServer.Server({
    port: 4000
});

//Отправляет response всем пользователям в комнате room
const sendMessages = (db_con,clients,room,response) => {
    const sql_select_users_in_room = `SELECT name FROM chat_user WHERE room=${room}`
    db_con.query(sql_select_users_in_room, function(err, roomates){
        if(err) console.log(`Error with ${sql_select_users_in_room}`);
        for (let key in clients) {
            if (roomates.some((roommate)=>{
                return roommate.name===clients[key].user
            })) {
                clients[key].ws.send(response)
            }
        }
    })
}
//Отправляет список существующих комнат по указанному подключению
const sendRooms = (db_con,connection) => {
    const sql_select_rooms = `SELECT id FROM chat_room`
    db_con.query(sql_select_rooms, function (err,rooms) {
        if (err) {
            console.log(`Error with ${sql_select_rooms}`)
            console.log(err)
        }
        connection.send(JSON.stringify({type:"RoomsList",rooms:rooms}))
    });
}

con.connect(function(err) {
    webSocketServer.on('connection', function(ws) {
        let id = Math.random();
        clients[id] = {ws:ws, user:null}
        console.log("Новое соединение " + id)
        ws.on('message', function(message) {
            const request = JSON.parse(message)
            clients[id]={ws:ws,user:request.user}
            console.log(request.type)
            switch (request.type) {
                //Для входа в комнату: добавляем в бд запись о пользователе в комнате и отправляем всем участникам response
                case "NewEntry":
                    {
                        const sql_insert_user = `INSERT INTO chat_user(name,room) VALUES ('${request.user}',${request.room})`
                        con.query(sql_insert_user, function(err,message){
                            if(err) console.log(`Error with ${sql_insert_user}`)
                        })
                        const sql_select = `SELECT author,content,date FROM chat_message WHERE room=${request.room}`
                        con.query(sql_select, function (err1, messages) {
                            if (err1) console.log(`Error with ${sql_insert_user}`);
                            const sql_select_users = `SELECT name FROM chat_user WHERE room=${request.room}`
                            con.query(sql_select_users, function (err2, users) {
                                if (err2) console.log(`Error with ${sql_select_users}`);
                                const response = JSON.stringify({type:request.type,messages:messages,users:users})
                                sendMessages(con,clients,request.room,response)
                            })
                        })
                    }
                    break;
                //Для нового сообщения: добавляем его в базу, отправляем всем получателям и отправителю
                case "NewMessage":
                    {
                        const sql_insert = `INSERT INTO chat_message(room, author, content) VALUES (${request.room},'${request.user}','${request.content}')`
                        con.query(sql_insert, function (err) {
                            if (err) {
                                console.log(`Error with ${sql_insert}`)
                                console.log(err)
                            }
                        });

                        const sql_select = `SELECT author,content,date FROM chat_message WHERE room=${request.room}`
                        con.query(sql_select, function (err, messages) {
                            if (err) console.log(`Error with ${sql_select}`)
                            let response = JSON.stringify({type:request.type,messages:messages})
                            sendMessages(con,clients,request.room,response)
                        });
                    }
                    break;
                case "RoomsList":
                    sendRooms(con,clients[id].ws)
                    break;
                case "NewRoom" :
                    {
                        const sql_insert_room = `INSERT INTO chat_room() VALUES ()`
                        con.query(sql_insert_room, function (err) {
                            if (err) {
                                console.log(`Error with ${sql_insert_room}`)
                                console.log(err)
                            }
                            sendRooms(con,clients[id].ws)
                        });
                    }
                    break;
                default:
                    console.log("Unknown request type")
            }
        });

        /**
         * Если для для соединения определено имя пользователя(только для комнаты)
         * То изменяем информацию о комнате, оповещаем других пользователей об этом
         * Иначе просто закрываем соединение
         * */
        ws.on('close', function() {
            const user = clients[id].user;
            if (user){
                //Узнаем, из какой комнаты вышел пользователь
                const sql_select_room = `SELECT room FROM chat_user WHERE name='${user}'`
                con.query(sql_select_room, function (err,message) {
                    if(err) console.log(`Error with ${sql_select_room}`);
                    let room = message[0]['room'];
                    //Удаляем пользователя из списка участников чат-комнаты
                    const sql_delete_user = `DELETE FROM chat_user WHERE name='${user}'`
                    con.query(sql_delete_user, function(err){
                        if(err) console.log(`Error with ${sql_delete_user}`)
                    });
                    //Оповещаем всех участников комнаты о новом составе комнаты
                    const sql_select_users_in_room = `SELECT name FROM chat_user WHERE room=${room}`
                    con.query(sql_select_users_in_room, function(err, message){
                        if(err) console.log(`Error with ${sql_select_users_in_room}`);
                        const response = JSON.stringify({type:'RefreshList',users:message})
                        sendMessages(con,clients,room,response)
                    })
                })
            }
            console.log('Соединение закрыто ' + id);
            delete clients[id];
        });
    });
});