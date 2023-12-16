// server.js
const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const AWS = require('aws-sdk');
const fs = require('fs');
const axios=require('axios');
const app = express();
const PORT = 4242;
const constants=require('./constants');
const multer= require('multer');
const upload = multer({ dest: "consult-images/" })
const OpenAI=require('openai');

// const db = mysql.createConnection({
//     host: 'stage-db-copy.c9bzeeqg7edj.ap-south-1.rds.amazonaws.com',
//     user: 'souser',
//     password: 'nv2VN0wAw6Ljw1iW',
//     database: 'sodb',
//   });

const openai=new OpenAI({
    apiKey: constants.OPENAI_ACCESS_KEY
})

const db = mysql.createConnection({
    host: constants.DB_HOST,
    user: constants.DB_USER,
    password: constants.DB_PASSWORD,
    database: constants.DB_DATABASE,
    port: constants.DB_PORT,
  });

  

AWS.config.update({
    accessKeyId: constants.AWS_ACCESS_KEY_ID,
    secretAccessKey: constants.AWS_SECRET_ACCESS_KEY,
    region: constants.AWS_REGION, // e.g., 'us-east-1'
});

const s3 = new AWS.S3();
const bucketName = constants.AWS_BUCKET_NAME;

const uploadImagesV2 = async (anaylsisId, images) => {
 
      try{
        const imageUrls = [];
        const promises = images.map((img,id) => {
            const filename = String(id);
            imageUrls.push(filename);
            if (consultationId) {
            return uploadImageToS3(
                filename,
                img,
                constants?.AWS_BUCKET_NAME
            );
            }
            return uploadImageToS3(filename, base64Encoded);
        });
        const imageUploadStatus = await Promise.all(promises);
        return imageUrls;
        

        }catch(e){
            console.log(e)
        }

    }

    async function executeQuery(query) {
        try {
          const connection = await pool.getConnection();
          const [rows, fields] = await connection.execute(query);
          connection.release();
        } catch (err) {
          console.error('Error executing the query:', err);
        } finally {
          pool.end();
        }
      }


async function uploadImageToS3(
    file,
    image,
    bucket = constants.AWS_BUCKET_NAME
    ) {
    let status = false;
    const upload = s3
        .upload({ Bucket: bucket, Key: file, Body: image })
        .promise();
    await upload
        .then(function (data) {
        status = true;
        })
        .catch(function (error) {
        logger.error("error in S3 image upload");
        console.log(error.message);
        status = false;
        });
    return status;
    }
     
    
  
     


db.connect((err) => {
if (err) {
    console.error('Error connecting to MySQL:', err);
} else {
    console.log('Connected to MySQL database');
}
});

// Middleware to parse JSON in request body
app.use(bodyParser.json());

// GET route
app.get('/health', (req, res) => {
  res.json({ message: 'This is a GET request.' });
});
 
//POST route
app.post('/file-upload',upload.array("files",12),async (req,res)=>{

    

    const images=req?.files;
    console.log(images)
    const url="https://vision.googleapis.com/v1/images:annotate?key="+constants.GOOLE_VISION_API_KEY;
    concated_ocr="";
    let res_array=[];

    for (const image of images){
        const image_content=fs.readFileSync(image.path).toString('base64');
        const payload = {
            "requests": [
              {
                "image": { "content": image_content },
                "features": [{ "type": "TEXT_DETECTION" }],
              },
            ],
          };
          
        res_array.push( axios.post(url, payload))

    }
    res_array=await Promise.all(res_array);
    for (const res of res_array){
        concated_ocr+=res.data.responses[0].fullTextAnnotation.text;
    }

    // console.log(concated_ocr.length);
    // return;


    const thread= await openai.beta.threads.create();
    const threadId=thread.id;

    const message= await openai.beta.threads.messages.create(threadId,{
        role:'user',
        content: concated_ocr.substring(0,32000)
    })

    
    const run = await openai.beta.threads.runs.create(threadId,{
        assistant_id:constants.OPEN_AI_ASSITANT_ID
    })

    let status=""
    while(status!="completed"){
        const test = await openai.beta.threads.runs.retrieve(
            threadId, 
            run.id
        )
        status=test.status
    }
    
    const messages= await openai.beta.threads.messages.list(threadId);
    res=messages.body.data[0].content[0].text.value
   

    // const query = "INSERT INTO consult_data () VALUES ();"
    // executeQuery(query)
    // uploadImagesV2(,images)
    res.json({ parsed: JSON.parse(res),res:res });
    // res.json({ OCR: res });

});




// POST route
app.post('/post', (req, res) => {
  const dataFromClient = req.body;
  console.log('Received data from client:', dataFromClient);
  res.json({ message: 'This is a POST request.' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
