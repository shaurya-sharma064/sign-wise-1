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
require('dotenv').config();
const {Translate}=require('@google-cloud/translate').v2;
const {TranslationServiceClient} = require('@google-cloud/translate');


const CREDENTIALS=JSON.parse(process.env.CREDENTIALS)

const translate= new Translate({
  credentials:CREDENTIALS,
  projectId:CREDENTIALS.project_id
})

const translationClient = new TranslationServiceClient({ credentials:CREDENTIALS,
  projectId:CREDENTIALS.project_id});
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
            if (anaylsisId) {
            return uploadImageToS3(
                filename,
                img,
                constants?.AWS_BUCKET_NAME+"/"+String(anaylsisId)
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
    concated_ocr=concated_ocr.substring(0,32000)
    const thread= await openai.beta.threads.create();
    const threadId=thread.id;

    const message= await openai.beta.threads.messages.create(threadId,{
        role:'user',
        content: concated_ocr
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
    resultant=JSON.parse(messages.body.data[0].content[0].text.value)
    const messageId=messages.body.data[0].id
    
    lang=req?.query?.lang
    if(lang && lang!="en"){
      for (let key in resultant){
        if (resultant.hasOwnProperty(key)) {
          try{
            [data]=await translate.translate(resultant[key],lang)
            resultant[key]= data
          }catch(e){
            console.log(e)

          }
          
        }
      }
      try{
        for (let key in resultant["parties"]){
          for(let innerkey in resultant["parties"][key]){
            try{
              [data]=await translate.translate(resultant["parties"][key][innerkey],lang)
              resultant["parties"][key][innerkey]= data
            }catch(e){
              console.log(e)
            }
          }
        }

      }catch(e){
        console.log(e)
      }
      
    }
   
    const query = "INSERT INTO consultation_data (thread_id,message_id) VALUES ('"+ threadId +"','"+ messageId+"');"
    console.log(query)
    db.query(query, (err, result) => {
        if (err) {
          console.error('Error executing query:', err);
        } else {
          console.log('Query executed successfully:', result);
          uploadImagesV2(result.insertId,[JSON.stringify(resultant)])
        }
        db.end();
      });
    
    //res.json({ });
    // executeQuery(query)
    // uploadImagesV2(,images)
    res.json({ parsed: resultant,threadId:threadId});
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
