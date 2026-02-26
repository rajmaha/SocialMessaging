CREATE TABLE IF NOT EXISTS sample_table (
    id INT AUTO_INCREMENT PRIMARY KEY,
    description VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO sample_table (description) VALUES ('Initial setup for [db_name]');
INSERT INTO sample_table (description) VALUES ('Database user is [db_user]');
