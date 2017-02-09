'use strict';

const config = require('./config');
const emailService = require('./email-service');
const pg = require('pg');
pg.defaults.ssl = true;


module.exports = function(phone_number, user_name, previous_job, years_of_experience, job_vacancy){
    let emailContent = 'A new job enquiery from ' + user_name + ' for the job: ' + job_vacancy +
        '.<br> Previous job position: ' + previous_job + '.' +
        '.<br> Years of experience: ' + years_of_experience + '.' +
        '.<br> Phone number: ' + phone_number + '.';

    emailService.sendEmail('New job application', emailContent);

    pg.connect(process.env.DATABASE_URL, function(err, client) {
        if (err) throw err;

        client
            .query(
                'INSERT into job_applications ' +
                '(phone_number, user_name, previous_job, years_of_experience, job_vacancy) ' +
                'VALUES($1, $2, $3, $4, $5) RETURNING id',
                [phone_number, user_name, previous_job, years_of_experience, job_vacancy],
                function(err, result) {
                    if (err) {
                        console.log(err);
                    } else {
                        console.log('row inserted with id: ' + result.rows[0].id);
                    }
                    ;
                });

    });
}
