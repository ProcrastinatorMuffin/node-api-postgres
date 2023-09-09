const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const SECRET = process.env.JWT_SECRET;
require('dotenv').config();


const Pool = require('pg').Pool
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Configure AWS S3
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: `eu-central-1`
});


const createUser = (request, response) => {
  const { email, password } = request.body;

  pool.query('SELECT * FROM users WHERE email = $1', [email], (error, results) => {
    if (error) {
      return response.status(500).json({ error: 'Failed to query database.' });
    }

    if (results.rows.length > 0) {
      return response.status(400).json({ error: 'Email already exists.' });
    }

    const passwordHash = bcrypt.hashSync(password, 8);

    pool.query(
      'INSERT INTO users (email, password_hash, verified) VALUES ($1, $2, $3) RETURNING *',
      [email, passwordHash, false],
      (error, results) => {
        if (error) {
          return response.status(500).json({ error: 'Failed to create user.' });
        }

        response.status(201).json(results.rows[0]);
      }
    );
  });
};

const loginUser = (request, response) => {
  const { email, password } = request.body;

  pool.query('SELECT * FROM users WHERE email = $1', [email], (error, results) => {
    if (error) {
      return response.status(500).json({ error: 'Failed to query database.' });
    }

    if (results.rows.length === 0) {
      return response.status(404).json({ error: 'User not found.' });
    }

    const user = results.rows[0];
    const passwordIsValid = bcrypt.compareSync(password, user.password_hash);

    if (!passwordIsValid) {
      return response.status(401).json({ error: 'Invalid password.' });
    }

    const token = jwt.sign({ id: user.id, verified: user.verified }, SECRET, {
      expiresIn: 86400 // expires in 24 hours
    });

    response.status(200).json({ auth: true, token });
  });
};

const verifyUser = (request, response) => {
  const { userId } = request.params;

  pool.query('SELECT * FROM users WHERE id = $1', [userId], (error, results) => {
    if (error) {
      return response.status(500).json({ error: 'Failed to query database.' });
    }

    if (results.rows.length === 0) {
      return response.status(404).json({ error: 'User not found.' });
    }

    pool.query('UPDATE users SET verified = true WHERE id = $1', [userId], (error, results) => {
      if (error) {
        return response.status(500).json({ error: 'Failed to verify user.' });
      }

      response.status(200).json({ message: 'User verified successfully.' });
    });
  });
};

const createCourse = (request, response) => {
  const { name, description, instructor } = request.body;

  pool.query(
    'INSERT INTO courses (name, description, instructor) VALUES ($1, $2, $3) RETURNING *',
    [name, description, instructor],
    (error, results) => {
      if (error) {
        return response.status(500).json({ error: 'Failed to create course.' });
      }

      response.status(201).json(results.rows[0]);
    }
  );
};

const createAssignment = (request, response) => {
  const { title, description, due_date, course_id } = request.body;

  pool.query(
    'INSERT INTO assignments (title, description, due_date, course_id) VALUES ($1, $2, $3, $4) RETURNING *',
    [title, description, due_date, course_id],
    (error, results) => {
      if (error) {
        return response.status(500).json({ error: 'Failed to create assignment.' });
      }

      response.status(201).json(results.rows[0]);
    }
  );
};

const createAttachment = async (request, response) => {
  const { title, description, due_date, course_id } = request.body;

  // Handle file upload to AWS S3
  const file = request.files && request.files.file;
  if (file) {
    const uploadParams = {
      Bucket: 'assignment-api-bucket',
      Key: `${new Date().toISOString()}-${file.name}`,
      Body: file.data,
    };

    try {
      const uploadData = await s3.upload(uploadParams).promise();
      const filePath = uploadData.Location;

      // Store assignment data and S3 URL into PostgreSQL
      pool.query(
        'INSERT INTO assignments (title, description, due_date, course_id, file_path) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [title, description, due_date, course_id, filePath],
        (error, results) => {
          if (error) {
            return response.status(500).json({ error: 'Failed to create attachment.' });
          }

          response.status(201).json(results.rows[0]);
        }
      );
    } catch (error) {
      return response.status(500).json({ error: 'Failed to upload file to S3.' });
    }
  } else {
    return response.status(400).json({ error: 'No file uploaded.' });
  }
};

const trackCourse = (request, response) => {
  const userId = request.params.userId;
  const courseId = request.params.courseId;

  pool.query('SELECT * FROM users WHERE id = $1', [userId], async (error, results) => {
    if (error) {
      return response.status(500).json({ error: 'Failed to query database.' });
    }

    if (results.rows.length === 0) {
      return response.status(404).json({ error: 'User not found.' });
    }

    const client = await pool.connect();

    try {
      const query = 'UPDATE users SET tracked_courses = array_append(tracked_courses, $1) WHERE id = $2';
      await client.query(query, [courseId, userId]);
      response.status(200).json({ message: 'Course added to tracked list.' });
    } catch (error) {
      return response.status(500).json({ error: 'Failed to add course to tracked list.' });
    } finally {
      client.release();
    }
  });
};


const untrackCourse = (request, response) => {
  const userId = request.params.userId;
  const courseId = request.params.courseId;

  pool.query('SELECT * FROM users WHERE id = $1', [userId], async (error, results) => {
    if (error) {
      return response.status(500).json({ error: 'Failed to query database.' });
    }

    if (results.rows.length === 0) {
      return response.status(404).json({ error: 'User not found.' });
    }

    const client = await pool.connect();

    try {
      const query = 'UPDATE users SET tracked_courses = array_remove(tracked_courses, $1) WHERE id = $2';
      await client.query(query, [courseId, userId]);
      response.status(200).json({ message: 'Course removed from tracked list.' });
    } catch (error) {
      return response.status(500).json({ error: 'Failed to remove course from tracked list.' });
    } finally {
      client.release();
    }
  });
};

const getTrackedCoursesForUser = (request, response) => {
  const userId = request.params.userId;

  pool.query('SELECT * FROM users WHERE id = $1', [userId], async (error, results) => {
    if (error) {
      return response.status(500).json({ error: 'Failed to query database.' });
    }

    if (results.rows.length === 0) {
      return response.status(404).json({ error: 'User not found.' });
    }

    const client = await pool.connect();

    try {
      const query = 'SELECT tracked_courses FROM users WHERE id = $1';
      const result = await client.query(query, [userId]);
      const courses = result.rows[0].tracked_courses;
      response.status(200).json(courses);
    } catch (error) {
      return response.status(500).json({ error: 'Failed to fetch tracked courses.' });
    } finally {
      client.release();
    }
  });
};

const getAttachments = (request, response) => {
  const { course_id } = request.params; // Assuming the course_id is a URL parameter

  pool.query(
    'SELECT file_path FROM assignments WHERE course_id = $1',
    [course_id],
    (error, results) => {
      if (error) {
        return response.status(500).json({ error: 'Failed to fetch attachments.' });
      }

      if (results.rows.length === 0) {
        return response.status(404).json({ error: 'No attachments found.' });
      }

      const filePaths = results.rows.map(row => row.file_path);
      response.status(200).json({ filePaths });
    }
  );
};


const getAllUsers = (request, response) => {
  pool.query('SELECT * FROM users', (error, results) => {
    if (error) {
      return response.status(500).json({ error: 'Failed to query database.' });
    }
    response.status(200).json(results.rows);
  });
};

const getVerifiedUsers = (request, response) => {
  pool.query('SELECT * FROM users WHERE verified=true', (error, results) => {
    if (error) {
      return response.status(500).json({ error: 'Failed to query database.' });
    }
    response.status(200).json(results.rows);
  });
};

const getUnverifiedUsers = (request, response) => {
  pool.query('SELECT * FROM users WHERE verified=false', (error, results) => {
    if (error) {
      return response.status(500).json({ error: 'Failed to query database.' });
    }
    response.status(200).json(results.rows);
  });
};

const getAllCourses = (request, response) => {
  pool.query('SELECT * FROM courses', (error, results) => {
    if (error) {
      return response.status(500).json({ error: 'Failed to query database.' });
    }
    response.status(200).json(results.rows);
  });
};

const getAllAssignments = (request, response) => {
  pool.query('SELECT * FROM assignments', (error, results) => {
    if (error) {
      return response.status(500).json({ error: 'Failed to query database.' });
    }
    response.status(200).json(results.rows);
  });
};

const updateCourse = (request, response) => {
  const { id } = request.params;
  const { name, description, instructor } = request.body;

  pool.query(
    'UPDATE courses SET name = $1, description = $2, instructor = $3 WHERE id = $4 RETURNING *',
    [name, description, instructor, id],
    (error, results) => {
      if (error) {
        return response.status(500).json({ error: 'Failed to update course.' });
      }
      if (results.rows.length === 0) {
        return response.status(404).json({ error: 'Course not found.' });
      }
      response.status(200).json(results.rows[0]);
    }
  );
};

const updateAssignment = (request, response) => {
  const { id } = request.params;
  const { title, description, due_date, course_id } = request.body;

  pool.query(
    'UPDATE assignments SET title = $1, description = $2, due_date = $3, course_id = $4 WHERE id = $5 RETURNING *',
    [title, description, due_date, course_id, id],
    (error, results) => {
      if (error) {
        return response.status(500).json({ error: 'Failed to update assignment.' });
      }
      if (results.rows.length === 0) {
        return response.status(404).json({ error: 'Assignment not found.' });
      }
      response.status(200).json(results.rows[0]);
    }
  );
};

const deleteCourse = (request, response) => {
  const { id } = request.params;

  pool.query(
    'DELETE FROM courses WHERE id = $1 RETURNING *',
    [id],
    (error, results) => {
      if (error) {
        return response.status(500).json({ error: 'Failed to delete course.' });
      }
      if (results.rows.length === 0) {
        return response.status(404).json({ error: 'Course not found.' });
      }
      response.status(204).send();
    }
  );
};

const deleteAssignment = (request, response) => {
  const { id } = request.params;

  pool.query(
    'DELETE FROM assignments WHERE id = $1 RETURNING *',
    [id],
    (error, results) => {
      if (error) {
        return response.status(500).json({ error: 'Failed to delete assignment.' });
      }
      if (results.rows.length === 0) {
        return response.status(404).json({ error: 'Assignment not found.' });
      }
      response.status(204).send();
    }
  );
};

module.exports = {
  createUser,
  loginUser,
  verifyUser,
  createCourse,
  createAssignment,
  createAttachment,
  trackCourse,
  untrackCourse,
  getTrackedCoursesForUser,
  getAttachments,
  getAllUsers,
  getVerifiedUsers,
  getUnverifiedUsers,
  getAllCourses,
  getAllAssignments,
  updateCourse,
  updateAssignment,
  deleteCourse,
  deleteAssignment,
  pool
};

