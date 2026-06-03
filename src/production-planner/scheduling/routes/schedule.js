const router = require('express').Router();
router.get("/schedule",)(req,res)=.{
    res.json({
        successd:true,
        message:"schedule working"
    })
}

module.exports = router;
