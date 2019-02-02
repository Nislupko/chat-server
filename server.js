const app = require('http').createServer(handler)
const io = require('socket.io')(app);
const mysql = require('mysql');
const config = require('./config-heroku')
const port = 4000;

function handler (req, res) {
    res.writeHead(200);
    res.end();
}
const con = mysql.createConnection(config);
//Если сервер аварийно завершил работу, необходимо удалить данные о пользователях в комнатах
con.query(`TRUNCATE chat_user`, function(err){
    if(err) console.log(`Error with TRUNCATE`)
})

io.on('connection', function (socket) {
    socket.on('initial', function (data) {
        const userName = JSON.stringify(data).match(/[^"\\]+/)[0]
        socket['userName'] = userName
        const sql_insert_new_user = `INSERT INTO chat_user(name) VALUES('${userName}')`
        con.query(sql_insert_new_user, function (err) {
            if (err) {
                console.log(`Error with ${sql_insert_new_user}`)
                console.log(err)
            }
        })
    })
    socket.on('change_name', function (data) {
        const sql_select_users = 'Select name from chat_user'
        con.query(sql_select_users, function (err,users) {
            if (err) {
                console.log(`Error with ${sql_update_user}`)
                console.log(err)
            }
            if (users.some((elem)=>{return elem.name===data})){
                socket.emit('bad_name',data)
            } else {
                const sql_update_user = `UPDATE chat_user SET name='${data}' WHERE name='${socket.userName}'`
                con.query(sql_update_user, function (err) {
                    if (err) {
                        console.log(`Error with ${sql_update_user}`)
                        console.log(err)
                    }
                })
                socket['userName'] = data
                socket.emit('good_name',data)
            }
        })
    })
    socket.on('room_list', function () {
        const sql_select_rooms = `SELECT id FROM chat_room`
        con.query(sql_select_rooms, function (err, rooms) {
            if (err) {
                console.log(`Error with ${sql_select_rooms}`)
            }
            socket.emit('room_list', JSON.stringify({rooms: rooms}))
        });
    });
    socket.on('new_room', function () {
        const sql_insert_room = `INSERT INTO chat_room() VALUES ()`
        con.query(sql_insert_room, function (err) {
            if (err) {
                console.log(`Error with ${sql_insert_room}`)
            }
            const sql_select_rooms = `SELECT id FROM chat_room`
            con.query(sql_select_rooms, function (err, rooms) {
                if (err) {
                    console.log(`Error with ${sql_select_rooms}`)
                }
                io.sockets.emit('room_list', JSON.stringify({rooms: rooms}))
            });
        });
    });
    socket.on('new_entry', function (data) {
        const request = JSON.parse(data)
        const sql_update_user = `UPDATE chat_user SET room=${request.room} WHERE name='${request.user}'`
        con.query(sql_update_user, function (err, message) {
            if (err) console.log(`Error with ${sql_update_user}`)
        })
        const sql_select = `SELECT author,content,date FROM chat_message WHERE room=${request.room}`
        con.query(sql_select, function (err1, messages) {
            if (err1) console.log(`Error with ${sql_select}`);
            const sql_select_users = `SELECT name FROM chat_user WHERE room=${request.room}`
            con.query(sql_select_users, function (err2, users_in_room) {
                if (err2) console.log(`Error with ${sql_select_users}`);
                socket.emit('new_message', JSON.stringify({messages: messages}))
                io.sockets.emit('new_entry', JSON.stringify({users: users_in_room}))
            })
        })
    });
    socket.on('exit_room', function (data) {
        const request = JSON.parse(data)
        //Удаляем пользователя из списка участников чат-комнаты
        const sql_update_user = `UPDATE chat_user SET room=null WHERE name='${request.user}'`
        con.query(sql_update_user, function (err) {
            if (err) console.log(`Error with ${sql_update_user}`)
        });
        //Оповещаем всех участников комнаты о новом составе комнаты
        const sql_select_users_in_room = `SELECT name FROM chat_user WHERE room=${request.room}`
        con.query(sql_select_users_in_room, function (err, message) {
            if (err) console.log(`Error with ${sql_select_users_in_room}`);
            const response = JSON.stringify({users: message})
            io.sockets.emit("new_entry", response)
        })
    })
    socket.on('create_message', function (data) {
        const request = JSON.parse(data)
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
            io.sockets.emit('new_message', JSON.stringify({messages: messages}))
        });
    })
    socket.on('disconnect', function () {
        if (socket.userName) {
            const sql_select_room = `SELECT room FROM chat_user WHERE name='${socket.userName}'`
            con.query(sql_select_room, function (err, message) {
                if (err) console.log(`Error with ${sql_select_room}`);
                let room = message[0]['room'];
                //Удаляем из базы
                const sql_delete_user = `DELETE FROM chat_user WHERE name='${socket.userName}'`
                con.query(sql_delete_user, function (err) {
                    if (err) console.log(`Error with ${sql_delete_user}`)
                });
                if (room) {
                    //удаляем из комнаты, оповещаем всех оставшихся
                    const sql_select_users_in_room = `SELECT name FROM chat_user WHERE room=${room}`
                    con.query(sql_select_users_in_room, function (err, users) {
                        if (err) console.log(`Error with ${sql_select_users_in_room}`);
                        io.sockets.emit('new_entry', JSON.stringify({users: users}))
                    })
                }
            })
        }
    })
})


io.listen(port);