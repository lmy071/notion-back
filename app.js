var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');

// TypeScript 路由编译后加载
var indexRouter = require('./routes/index');
var userRouter = require('./dist/routes/user').default;
var syncRouter = require('./dist/routes/sync').default;

// 导入 API 日志中间件
var apilogger = require('./dist/apilogger').default;

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// 应用 API 日志中间件（在路由之前）
// 自动记录所有 /api 开头的接口调用
app.use(apilogger);

app.use('/', indexRouter);

// 用户API路由
app.use('/api/user', userRouter);

// 同步API路由
app.use('/api/sync', syncRouter);

// 健康检查接口
app.get('/api/health', function(req, res) {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'notion-sync',
  });
});

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
