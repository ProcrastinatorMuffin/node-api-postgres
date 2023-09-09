const express = require('express')
const app = express()
const fileUpload = require('express-fileupload');
const db = require('./queries')
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());

app.get('/', (request, response) => {
  response.json({ info: 'Node.js, Express, and Postgres API' })
})

// Users
app.post('/users', db.createUser);  // Create user

app.post('/users/login', db.loginUser);  // Log in user

app.patch('/users/:userId/verify', db.verifyUser);  // Verify user

app.get('/users', db.getAllUsers);  // Get all users

app.get('/users/unverified', db.getUnverifiedUsers); // Get unverified users

app.get('/users/verified', db.getVerifiedUsers);  // Get verified users


// Courses
app.post('/courses', db.createCourse);  // Create course

app.get('/courses', db.getAllCourses);  // Get all courses

app.patch('/courses/:id/update', db.updateCourse);  // Update course

app.delete('/courses/:id/delete', db.deleteCourse);  // Delete course

app.patch('/users/:userId/courses/:courseId/track', db.trackCourse);  // Track course

app.patch('/users/:userId/courses/:courseId/untrack', db.untrackCourse);  // Untrack course

app.get('/users/:userId/tracked-courses', db.getTrackedCoursesForUser);  // Get tracked courses


// Assignments
app.post('/courses/:course_id/assignments', db.createAssignment);  // Create assignment

app.get('/assignments', db.getAllAssignments);  // Get all assignments

app.patch('/assignments/:id/update', db.updateAssignment);  // Update assignment

app.delete('/assignments/:id/delete', db.deleteAssignment);  // Delete assignment


// Attachments
app.post('/courses/:course_id/assignments/:assignment_id/attachments', db.createAttachment);  // Create attachment

app.get('/courses/:course_id/attachments', db.getAttachments);  // Get attachments


// Start server
app.listen(port, () => {
  console.log(`App running on port ${port}.`)
})

db.pool.connect((err, client, release) => {
  if (err) {
    return console.error('Error acquiring client', err.stack)
  }
  client.query('SELECT NOW()', (err, result) => {
    release()
    if (err) {
      return console.error('Error executing query', err.stack)
    }
    console.log(result.rows)
  })
})
