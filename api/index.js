const _ = require('lodash')
const { authorize, constructScope, fetchPermissions } = require('./services/perm')
const { camelizeKeys } = require('humps')
const { handlerError } = require('./comm')
const { setupClientCache } = require('./middle/comm')
const { tracer } = require('./middle/gcLogger/comm')
const { verifyToken, } = require('./middle/member/comm')
const CONFIG = require('./config')
const bodyParser = require('body-parser')
const debug = require('debug')('README:api')
const express = require('express')
const jwtExpress = require('express-jwt')

const apiHost = CONFIG.API_PROTOCOL + '://' + CONFIG.API_HOST + ':' + CONFIG.API_PORT
const router = express.Router()
const superagent = require('superagent')

const authVerify = jwtExpress({ secret: CONFIG.JWT_SECRET })

router.use(bodyParser.urlencoded({ extended: false }))
router.use(bodyParser.json())

const fetchPromise = (url, req) => {
  return new Promise((resolve, reject) => {
    superagent
    .get(`${apiHost}${url}`)
    .end((err, res) => {
      if (!err && res) {
        resolve(camelizeKeys(res.body))
      } else {
        reject(err)
        console.error(`error during fetch data from : ${url}`)
        console.error(err) 
      }
    })
  })
}

router.use('/enews-group-list/list', authVerify, (req, res) => {
  debug('Got id', req.query.id)
  debug('Got id', req.body.id)

  if (!req.query.id) {
    res.json({ _items: [
      { group_name: '滄海一聲笑', count: 222, updated_at: '2018-10-19T03:37:11Z', created_at: '2018-10-19T03:37:11Z', id: 0, },
      { group_name: '智齒大王', count: 32, updated_at: '2018-10-20T03:37:11Z', created_at: '2018-10-20T03:37:11Z', id: 1, },
    ]})
  } else {
    res.json({ _items: [
      { nickname: '滄海一聲fasdff笑', id: 222, mail: 'fasdf', active: 1, updated_at: '2018-10-19T03:37:11Z', created_at: '2018-10-19T03:37:11Z', },
      { nickname: '智asdff齒大王', id: 32, mail: 'fasd22', active: 0, updated_at: '2018-10-20T03:37:11Z', created_at: '2018-10-20T03:37:11Z', },
    ]})
  }
})


router.use('/', (req, res, next) => {
  req.url_origin = req.url
  next()
})
router.use('/asset', require('./middle/assets'), tracer)
router.use('/login', authVerify, require('./middle/member/login'), )
router.use('/activate', verifyToken, require('./middle/member/activation'))
router.use('/project', authVerify, require('./middle/project'), tracer)
router.use('/report', authVerify, require('./middle/report'))
router.use('/memo', authVerify, require('./middle/memo'))
router.use('/member', authVerify, require('./middle/member'))
router.use('/members', authVerify, require('./middle/member'))
router.use('/post', [ authVerify, authorize ], require('./middle/post'), tracer)
router.use('/poll', [ authVerify, authorize ], require('./middle/poll'), tracer)
router.use('/tags', authVerify, require('./middle/tags'))
router.use('/token', require('./middle/services/token'))
router.use('/trace', (req, res, next) => {
  debug('trace', req.url)
  if  (CONFIG.GCP_PROJECT_ID && CONFIG.GCP_KEYFILE && CONFIG.GCP_STACKDRIVER_LOG_NAME) {
    next()
  } else {
    /**
     * have to setup config GCP_PROJECT_ID, GCP_KEYFILE and GCP_STACKDRIVER_LOG_NAME to activate tracing.
     */
    res.status(404).send('404 | Not found.').end()
  }
}, require('./middle/gcLogger'))

router.get('/available-ms', (req, res) => {
  console.log('Going to give available models for host:', req.identifier)
  res.json(_.get(CONFIG, [ 'AVAILABLE_MODELS', req.identifier ], []))
})
router.get('/profile', [ authVerify, setupClientCache, ], (req, res) => {
  debug('req.user')
  debug(req.user)
  const targetProfile = req.user.id
  const roleSetInToken = req.user.role

  /**
   * 'cause there's some logged-user's cookie token constructed with id which is in old type,
   * we have to redirect them to login again.
   */
  if (typeof(targetProfile) === 'string') {
    res.status(401).json({ message: 'Should Authorized Again.', })
    return
  }

  const url = `/member/${targetProfile}`
  Promise.all([
    fetchPromise(url, req),
    fetchPermissions(),
  ]).then((response) => {
    const profile = response[ 0 ][ 'items' ][ 0 ]
    const perms = response[ 1 ]
    const scopes = constructScope(perms, profile.role)

    if (roleSetInToken !== profile.role) {
      /**
       * This statement means this user's role has been changed. At this moment, we need to force user to login again.
       */
      res.status(401).json({ message: 'Should Authorized Again.', })
      return
    }

    res.json({
      name: profile.name,
      nickname: profile.nickname,
      mail: profile.mail,
      description: profile.description,
      id: profile.id,
      uuid: profile.uuid,
      role: profile.role,
      scopes,
      profileImage: profile.profileImage,
      points: profile.points,
    })
  }).catch((err) => {
    res.status(500).send(err)
    console.error(`Error occurred when fetching data from : ${url}`)
    console.error(err)
  })
})

router.get('/status', [ authVerify, setupClientCache, ], function(req, res) {
  res.status(200).send(true)
})

router.route('*')
  .get(function (req, res, next) {
    debug('Abt to send req to api.')
    const url = `${apiHost}${req.url}`
    superagent
      .get(url)
      .timeout(
        {
          response: CONFIG.API_TIMEOUT,  // Wait 5 seconds for the server to start sending,
          deadline: CONFIG.API_DEADLINE ? CONFIG.API_DEADLINE : 60000, // but allow 1 minute for the file to finish loading.
        }
      )
      .end((e, r) => {
        if (!e && r) {
          const resData = JSON.parse(r.text)
          res.json(resData)
        } else {
          const errWrapped = handlerError(e, r)
          res.status(errWrapped.status).send({
            status: errWrapped.status,
            text: errWrapped.text
          })       
          console.error(`Error occurred during updating report: ${url}`)
          console.error(e)     
        }
      })
  })
  .post(authVerify, (req, res) => {
    const url = `${apiHost}${req.url}`
     superagent
    .post(url)
    .send(req.body)
    .end((err, response) => {
      if (!err && response) {
        res.status(200).end()
      } else {
        const errWrapped = handlerError(err, response)
        res.status(errWrapped.status).send({
          status: errWrapped.status,
          text: errWrapped.text
        })       
        console.error(`Error occurred during updating report: ${req.url}`)
        console.error(err)     
      }
    })
  })
  .put(authVerify, function (req, res) {
    const url = `${apiHost}${req.url}`
    debug('Got a put req', req.url)
    superagent
    .put(url)
    .send(req.body)
    .end((err, response) => {
      if (!err && response) {
        res.status(200).end()
      } else {
        const errWrapped = handlerError(err, response)
        res.status(errWrapped.status).send({
          status: errWrapped.status,
          text: errWrapped.text
        })       
        console.error(`Error occurred during updating report: ${req.url}`)
        console.error(err)     
      }
    })
  })
  .delete(authVerify, function (req, res) {
    const url = `${apiHost}${req.url}`
    const params = req.body || {}
    superagent
    .delete(url)
    .send(params)
    .end((err, response) => {
      if (!err && response) {
        res.status(200).end()
      } else {
        const errWrapped = handlerError(err, response)
        res.status(errWrapped.status).send({
          status: errWrapped.status,
          text: errWrapped.text
        })       
        console.error(`Error occurred during updating report: ${req.url}`)
        console.error(err)     
      }
    })
  })

router.use(function (err, req, res, next) {
  if (err.name === 'UnauthorizedError' && req.url.indexOf('/status') === -1) {
    console.error('Error occurred:', err)
    res.status(401).send('invalid token...')
  } else if (err && req.url.indexOf('/status') > -1) {
    if (err.name === 'UnauthorizedError') {
      res.status(200).send(false)
    } else {
      console.error('Error occurred when checking login status', err)
    }
  }
})

module.exports = router