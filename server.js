const app = require('http').createServer()
const io = require('socket.io')(app);
const mysql = require('mysql');
const config = require('./config')
const port = 4000;

//Хранилище текущих сокетов в формате client.[id]=socket
let clients = {}

//Функция отсылает всем пользователям в указанной комнате заданные сообщения
const informClients=(clients,room,socket,emit_type='new_entry',data_to_send=null)=>{
  try{
    const con = mysql.createConnection(config);
    const sql_select_users = `SELECT name FROM chat_user WHERE room=${room}`
    con.query(sql_select_users, function (err2, users_in_room) {
        if (err2) console.log(`Error with ${sql_select_users}`);
        for (let key in clients){
            //Если пользователь в комнате и выбранный пользователь сокета совпадают, то отправялем ему сообщение
            if (users_in_room.some(person=>{
                return person.name===clients[key].userName
            })) {
                clients[key].emit(emit_type, JSON.stringify(data_to_send||{users: users_in_room}))
            }
        }
    })
    con.end()
  } catch (e) {
    console.log(`Server works wrong because of error: ${e}`)
  }
}

try{
  //Если сервер аварийно завершил работу, необходимо удалить данные о пользователях в комнатах
  const init_con = mysql.createConnection(config);
  init_con.query(`TRUNCATE chat_user`, function(err){
    if(err) console.log(`Error with TRUNCATE chat_user`)
  })
  init_con.end()
  //Создание сокет-соединения и обработка входящих запросов
  io.on('connection', function (socket) {
    //При входе в приложение записывем в сокет userName пользователя, добавляем его в базу
    socket.on('initial', function (data) {
        try{
          const con = mysql.createConnection(config)
          const userName = JSON.stringify(data).match(/[^"\\]+/)[0]
          socket['userName'] = userName
          clients[socket.id]=socket
          const sql_insert_new_user = `INSERT INTO chat_user(name) VALUES('${userName}')`
          con.query(sql_insert_new_user, function (err) {
            if (err) {
              console.log(`Error with ${sql_insert_new_user}`)
              console.log(err)
              con.end()
            }
          })
        } catch (e) {
          console.log(`Server works wrong because of error: ${e}`)
        }
    })
    //При изменении имени проверяем, существует ли оно. Если нет, заносим в базу, меняем userName сокета. Отправляем ответ
    socket.on('change_name', function (data) {
        try{
          const con = mysql.createConnection(config)
          const sql_select_users = 'Select name from chat_user'
          con.query(sql_select_users, function (err,users) {
            if (err) {
              console.log(`Error with ${sql_select_users}`)
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
              con.end()
            }
          })
        } catch (e) {
          console.log(`Server works wrong because of error: ${e}`)
        }
    })
    //При запросе на список комнат получаем его а базе и отдаем клиенту
    socket.on('room_list', function () {
        try{
            const con = mysql.createConnection(config)
            const sql_select_rooms = `SELECT id FROM chat_room`
            con.query(sql_select_rooms, function (err, rooms) {
                if (err) {
                console.log(`Error with ${sql_select_rooms}`)
                }
                socket.emit('room_list', JSON.stringify({rooms: rooms}))
            });
            con.end()
        } catch (e) {
            console.log(`Server works wrong because of error: ${e}`)
        }
    });
    //При создании новой комнаты создаем запись в бд и возвращаем всем пользователям новый список комнат
    socket.on('new_room', function () {
        try{
          const con = mysql.createConnection(config)
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
              con.end()
            });
          });
        } catch (e) {
          console.log(`Server works wrong because of error: ${e}`)
        }
    });
    //При  входе в комнату отправляем вошедушему список сообщений и отправляем всем в комнате новый список участников
    socket.on('new_entry', function (data) {
        try{
          const con = mysql.createConnection(config)
          const request = JSON.parse(data)
          const sql_update_user = `UPDATE chat_user SET room=${request.room} WHERE name='${request.user}'`
          con.query(sql_update_user, function (err) {
            if (err) console.log(`Error with ${sql_update_user}`)
          })
          const sql_select = `SELECT author,content,date FROM chat_message WHERE room=${request.room}`
          con.query(sql_select, function (err1, messages) {
            if (err1) console.log(`Error with ${sql_select}`);
            informClients(clients,request.room,socket)
            socket.emit('new_message',JSON.stringify({messages:messages}))
            con.end()
          })
        } catch (e) {
          console.log(`Server works wrong because of error: ${e}`)
        }
    })
    //При выходе из комнаты меняем в бд комнату пользователя на null и отправляем всем в комнате новый список участников
    socket.on('exit_room', function (data) {
        try{
          const con = mysql.createConnection(config)
          const request = JSON.parse(data)
          //Удаляем пользователя из списка участников чат-комнаты
          const sql_update_user = `UPDATE chat_user SET room=null WHERE name='${request.user}'`
          con.query(sql_update_user, function (err) {
            if (err) console.log(`Error with ${sql_update_user}`)
            con.end()
          });
          //Оповещаем всех участников комнаты о новом составе комнаты
          informClients(clients,request.room,socket)
        } catch (e) {
          console.log(`Server works wrong because of error: ${e}`)
        }
    })
    //При создании сообщения заносим его в базу и возращаем новый список сообщений всем в комнате
    socket.on('create_message', function (data) {
      const con = mysql.createConnection(config)
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
        try{
            const response = {messages:messages}
            informClients(clients,request.room,socket,'new_message',response)
            con.end()
        } catch (e) {
          console.log(`Server works wrong because of error: ${e}`)
        }
      })
    })
    //При закрытии/обновлении вкладки удаляем пользователя из бд. Если он был в комнате - оповещаем всех о новом составе
    socket.on('disconnect', function () {
      const con = mysql.createConnection(config)
      if (socket.userName) {
        const sql_select_room = `SELECT room FROM chat_user WHERE name='${socket.userName}'`
        con.query(sql_select_room, function (err, message) {
            try{
              if (err) console.log(`Error with ${sql_select_room}`);
              let room = message[0]['room'];
              //Удаляем из базы
              const sql_delete_user = `DELETE FROM chat_user WHERE name='${socket.userName}'`
              con.query(sql_delete_user, function (err) {
                if (err) console.log(`Error with ${sql_delete_user}`)
              });
              if (room) {
                //удаляем из комнаты, оповещаем всех оставшихся
                informClients(clients,room,socket)
              }
              con.end()
            } catch (e) {
              console.log(`Server works wrong because of error: ${e}`)
            }

        })
      }
    })
  })
} catch(error){
    console.log(`Server works wrong because of error: ${error}`)
}


io.listen(port);